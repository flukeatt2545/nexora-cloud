package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const (
	maxAttempts       = 3
	portLockID  int64 = 724_661_920
)

type config struct {
	databaseURL          string
	dockerSocket         string
	portMin              int
	portMax              int
	gatewayContainer     string
	tenantDBContainer    string
	s3Endpoint           string
	s3AccessKey          string
	s3SecretKey          string
	s3Bucket             string
	s3UseSSL             bool
	hostingEncryptionKey string
	tenantMySQLDSN       string
	pollInterval         time.Duration
	healthInterval       time.Duration
	leaseDuration        time.Duration
	botSubnet            string
}

type worker struct {
	cfg    config
	db     *pgxpool.Pool
	docker *dockerClient
	store  *minio.Client
	bots   *botState
}

type operation struct {
	ID             int64
	OperationID    string
	SiteID         int64
	ActorID        *int64
	Kind           string
	Attempt        int
	TimeoutSeconds int
	Metadata       map[string]any
	Site           site
}

type site struct {
	PublicID       string
	ProjectType    string
	DetectedType   string
	PackageManager string
	InstallCommand string
	BuildCommand   string
	StartCommand   string
	Status         string
	CPUMillicores  int64
	MemoryMB       int64
	ProcessLimit   int64
	DiskLimitMB    int64
	Deleted        bool
}

type operationFailure struct {
	code      string
	message   string
	retryable bool
	cause     error
}

func (e *operationFailure) Error() string {
	if e.cause != nil {
		return e.cause.Error()
	}
	return e.message
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	db, err := pgxpool.New(ctx, cfg.databaseURL)
	if err != nil {
		log.Fatalf("database configuration failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		log.Fatalf("database is unavailable: %v", err)
	}

	store, err := minio.New(cfg.s3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.s3AccessKey, cfg.s3SecretKey, ""),
		Secure: cfg.s3UseSSL,
	})
	if err != nil {
		log.Fatalf("object storage configuration failed: %v", err)
	}
	w := &worker{
		cfg:    cfg,
		db:     db,
		docker: newDockerClient(cfg.dockerSocket),
		store:  store,
		bots:   newBotState(),
	}
	if err := w.docker.ping(ctx); err != nil {
		log.Fatalf("Docker Engine is unavailable: %v", err)
	}

	log.Printf("NEXORA runtime worker started (ports %d-%d)", cfg.portMin, cfg.portMax)
	go w.monitor(ctx)
	go w.expirationLoop(ctx)
	w.startBots(ctx)

	ticker := time.NewTicker(cfg.pollInterval)
	defer ticker.Stop()
	for {
		worked, err := w.processOne(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("operation poll failed: %v", err)
		}
		if worked {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func loadConfig() (config, error) {
	portMin := envInt("HOSTING_PORT_MIN", 20000)
	portMax := envInt("HOSTING_PORT_MAX", 20999)
	if portMin < 1024 || portMax > 65535 || portMin > portMax || portMax-portMin > 10000 {
		return config{}, errors.New("invalid hosting port range")
	}
	return config{
		databaseURL:          env("DATABASE_URL", "postgres://nexora:nexora@localhost:5432/nexora?sslmode=disable"),
		dockerSocket:         env("DOCKER_SOCKET", "/var/run/docker.sock"),
		portMin:              portMin,
		portMax:              portMax,
		gatewayContainer:     env("RUNTIME_GATEWAY_CONTAINER", "nexora-runtime-gateway"),
		tenantDBContainer:    env("TENANT_DB_CONTAINER", "nexora-tenant-db"),
		s3Endpoint:           env("S3_ENDPOINT", "minio:9000"),
		s3AccessKey:          env("S3_ACCESS_KEY", "nexora"),
		s3SecretKey:          env("S3_SECRET_KEY", "change-this-minio-password"),
		s3Bucket:             env("S3_BUCKET", "nexora-assets"),
		s3UseSSL:             envBool("S3_USE_SSL", false),
		hostingEncryptionKey: env("HOSTING_ENCRYPTION_KEY", "local-only-change-this-hosting-encryption-key"),
		tenantMySQLDSN:       env("TENANT_MYSQL_DSN", "root:change-this-mysql-password@tcp(tenant-db:3306)/?parseTime=true&multiStatements=false"),
		pollInterval:         time.Second,
		healthInterval:       15 * time.Second,
		leaseDuration:        5 * time.Minute,
		botSubnet:            env("BOT_NETWORK_SUBNET", "172.31.250.0/24"),
	}, nil
}

func (w *worker) processOne(ctx context.Context) (bool, error) {
	op, err := w.claimOperation(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	timeout := time.Duration(op.TimeoutSeconds) * time.Second
	if timeout < time.Second {
		timeout = 5 * time.Minute
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	w.runtimeLog(ctx, op.SiteID, op.OperationID, "system", "เริ่มดำเนินการ "+op.Kind)
	runErr := w.execute(runCtx, op)
	if runErr == nil {
		if err := w.completeOperation(ctx, op); err != nil {
			return true, err
		}
		w.captureLogs(ctx, op)
		w.runtimeLog(ctx, op.SiteID, op.OperationID, "system", "ดำเนินการสำเร็จ")
		return true, nil
	}

	failure := normalizeFailure(runErr)
	log.Printf("operation %s (%s) failed: %v", op.OperationID, op.Kind, runErr)
	if failure.retryable && op.Attempt < maxAttempts && ctx.Err() == nil {
		if err := w.retryOperation(ctx, op, failure); err != nil {
			return true, err
		}
		w.runtimeLog(ctx, op.SiteID, op.OperationID, "system", fmt.Sprintf("ดำเนินการไม่สำเร็จ ระบบจะลองใหม่ (%d/%d)", op.Attempt+1, maxAttempts))
		return true, nil
	}
	if err := w.failOperation(ctx, op, failure); err != nil {
		return true, err
	}
	w.runtimeLog(ctx, op.SiteID, op.OperationID, "stderr", failure.message)
	return true, nil
}

func (w *worker) claimOperation(ctx context.Context) (operation, error) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return operation{}, err
	}
	defer tx.Rollback(ctx)

	var op operation
	var metadata []byte
	err = tx.QueryRow(ctx, `
		SELECT o.id,o.operation_id,o.site_id,o.actor_user_id,o.kind,o.attempt,o.timeout_seconds,o.metadata,
		       s.public_id,s.project_type,COALESCE(s.detected_project_type,''),s.package_manager,
		       s.install_command,s.build_command,s.start_command,s.status,
		       s.cpu_millicores,s.memory_mb,s.process_limit,s.disk_limit_mb,(s.deleted_at IS NOT NULL)
		FROM hosting_operations o
		JOIN hosting_sites s ON s.id=o.site_id
		WHERE o.state='queued'
		  AND COALESCE(NULLIF(o.metadata->>'retryAt','')::timestamptz, NOW()) <= NOW()
		ORDER BY o.id
		FOR UPDATE OF o SKIP LOCKED
		LIMIT 1
	`).Scan(
		&op.ID, &op.OperationID, &op.SiteID, &op.ActorID, &op.Kind, &op.Attempt, &op.TimeoutSeconds, &metadata,
		&op.Site.PublicID, &op.Site.ProjectType, &op.Site.DetectedType, &op.Site.PackageManager,
		&op.Site.InstallCommand, &op.Site.BuildCommand, &op.Site.StartCommand, &op.Site.Status,
		&op.Site.CPUMillicores, &op.Site.MemoryMB, &op.Site.ProcessLimit, &op.Site.DiskLimitMB, &op.Site.Deleted,
	)
	if err != nil {
		return operation{}, err
	}
	if err := json.Unmarshal(metadata, &op.Metadata); err != nil {
		op.Metadata = map[string]any{}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE hosting_operations
		SET state='running',phase='claimed',started_at=NOW(),updated_at=NOW(),
		    metadata=metadata-'retryAt'
		WHERE id=$1
	`, op.ID); err != nil {
		return operation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return operation{}, err
	}
	return op, nil
}

func (w *worker) execute(ctx context.Context, op operation) error {
	if op.Site.Deleted && op.Kind != "site.delete" {
		return fail("site_deleted", "เว็บไซต์นี้ถูกลบแล้ว", false, nil)
	}
	switch op.Kind {
	case "runtime.start":
		return w.startRuntime(ctx, op, false)
	case "runtime.stop":
		return w.stopRuntime(ctx, op, false)
	case "runtime.restart":
		if err := w.stopRuntime(ctx, op, false); err != nil {
			return err
		}
		return w.startRuntime(ctx, op, false)
	case "runtime.rebuild", "runtime.redeploy":
		return w.startRuntime(ctx, op, true)
	case "site.delete":
		return w.deleteRuntime(ctx, op)
	default:
		return fail("unsupported_operation", "ระบบยังไม่รองรับคำสั่งนี้", false, nil)
	}
}

func (w *worker) startRuntime(ctx context.Context, op operation, replaceWorkspace bool) error {
	if err := validateRuntimeCommands(op.Site); err != nil {
		return fail("command_not_allowed", "คำสั่งติดตั้งหรือเริ่มระบบไม่ได้รับอนุญาต", false, err)
	}

	name := runtimeContainerName(op.Site.PublicID)
	if !replaceWorkspace {
		if inspect, err := w.docker.inspectContainer(ctx, name); err == nil {
			if inspect.State.Running {
				_ = w.ensureCodeServerContainer(ctx, op.Site.PublicID)
				return w.markRunning(ctx, op, inspect.State.Health.Status)
			}
			if err := w.docker.startContainer(ctx, name); err != nil {
				return fail("docker_start_failed", "ไม่สามารถเริ่มเว็บไซต์ได้", true, err)
			}
			if err := w.waitUntilHealthy(ctx, op); err != nil {
				return err
			}
			_ = w.ensureCodeServerContainer(ctx, op.Site.PublicID)
			return nil
		} else if !errors.Is(err, errDockerNotFound) {
			return fail("docker_unavailable", "ไม่สามารถตรวจสอบ Container ได้", true, err)
		}
	}

	if err := w.cleanupRuntime(ctx, op.Site, replaceWorkspace); err != nil {
		return fail("cleanup_failed", "ไม่สามารถเตรียม Runtime เดิมได้", true, err)
	}
	port, err := w.reservePort(ctx, op.SiteID)
	if err != nil {
		return fail("port_unavailable", "ไม่มี Port ว่างสำหรับเว็บไซต์", true, err)
	}
	cleanupOnFailure := true
	defer func() {
		if cleanupOnFailure {
			_ = w.cleanupRuntime(context.Background(), op.Site, replaceWorkspace)
		}
	}()

	network := runtimeNetworkName(op.Site.PublicID)
	volume := runtimeVolumeName(op.Site.PublicID)
	volumeExists := w.docker.volumeExists(ctx, volume)
	if err := w.docker.createNetwork(ctx, network, true); err != nil {
		return fail("network_create_failed", "ไม่สามารถสร้าง Network ของเว็บไซต์ได้", true, err)
	}
	if err := w.docker.connectNetwork(ctx, network, w.cfg.gatewayContainer); err != nil {
		return fail("gateway_connect_failed", "ไม่สามารถเชื่อมเว็บไซต์กับ Gateway ได้", true, err)
	}
	if err := w.docker.connectNetwork(ctx, network, w.cfg.tenantDBContainer); err != nil {
		return fail("database_network_failed", "ไม่สามารถเชื่อมเว็บไซต์กับฐานข้อมูลได้", true, err)
	}
	if err := w.docker.createVolume(ctx, volume); err != nil {
		return fail("workspace_create_failed", "ไม่สามารถสร้าง Workspace ได้", true, err)
	}

	if replaceWorkspace || !volumeExists {
		artifact := metadataString(op.Metadata, "deploymentKey")
		if artifact == "" {
			artifact, _ = w.latestDeploymentKey(ctx, op.SiteID)
		}
		if artifact != "" {
			archive, detected, archiveErr := w.deploymentArchive(ctx, artifact, op.Site.DiskLimitMB)
			if archiveErr != nil {
				return archiveErr
			}
			if err := w.docker.populateVolume(ctx, volume, archive); err != nil {
				return fail("workspace_prepare_failed", "ไม่สามารถเตรียมไฟล์เว็บไซต์ได้", true, err)
			}
			if detected != "" {
				op.Site.DetectedType = detected
				_, _ = w.db.Exec(ctx, `UPDATE hosting_sites SET detected_project_type=$2,updated_at=NOW() WHERE id=$1`, op.SiteID, detected)
			}
			if err := w.runBuild(ctx, op, volume); err != nil {
				return err
			}
		} else if replaceWorkspace {
			return fail("deployment_missing", "ยังไม่มีไฟล์เว็บไซต์ กรุณาอัปโหลดหรือสร้าง Starter ก่อน", false, nil)
		}
	}

	spec, err := runtimeSpecFor(op.Site, port, network, volume)
	if err != nil {
		return fail("runtime_invalid", "การตั้งค่า Runtime ไม่ถูกต้อง", false, err)
	}
	environment, err := w.loadRuntimeEnvironment(ctx, op.SiteID)
	if err != nil {
		return fail("environment_unavailable", "ไม่สามารถเตรียมตัวแปรของเว็บไซต์ได้", false, err)
	}
	spec.Environment = append(spec.Environment, environment...)
	if err := w.docker.pullImage(ctx, spec.Image); err != nil {
		return fail("image_pull_failed", "ไม่สามารถเตรียม Runtime image ได้", true, err)
	}
	containerID, err := w.docker.createRuntimeContainer(ctx, name, spec, op.Site)
	if err != nil {
		return fail("container_create_failed", "ไม่สามารถสร้าง Container ได้", true, err)
	}
	if _, err := w.db.Exec(ctx, `
		UPDATE hosting_sites
		SET runtime_container_id=$2,runtime_port=$3,status='provisioning',
		    health_status='starting',updated_at=NOW()
		WHERE id=$1
	`, op.SiteID, containerID, port); err != nil {
		return fail("runtime_state_failed", "ไม่สามารถบันทึกสถานะ Runtime ได้", true, err)
	}
	if err := w.docker.startContainer(ctx, name); err != nil {
		return fail("container_start_failed", "ไม่สามารถเริ่ม Container ได้", true, err)
	}
	if err := w.activateLease(ctx, op.SiteID); err != nil {
		return fail("port_lease_failed", "ไม่สามารถยืนยัน Port ของเว็บไซต์ได้", true, err)
	}
	if err := w.waitUntilHealthy(ctx, op); err != nil {
		return err
	}
	cleanupOnFailure = false
	_ = w.ensureCodeServerContainer(ctx, op.Site.PublicID)
	return nil
}

func validRuntimeEnvironmentName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for index, char := range []byte(name) {
		if (char >= 'A' && char <= 'Z') || char == '_' || (index > 0 && char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	switch name {
	case "PORT", "HOME", "HOSTNAME", "NODE_ENV", "PATH", "PWD", "USER", "SHELL":
		return false
	}
	return true
}

func decryptEnvironmentValue(ciphertext, passphrase string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", errors.New("invalid encrypted environment value")
	}
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted environment value")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("cannot decrypt environment value")
	}
	return string(plain), nil
}

func (w *worker) loadRuntimeEnvironment(ctx context.Context, siteID int64) ([]string, error) {
	rows, err := w.db.Query(ctx, `
		SELECT name,value_ciphertext
		FROM hosting_environment_variables
		WHERE site_id=$1
		ORDER BY name
	`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var name, ciphertext string
		if err := rows.Scan(&name, &ciphertext); err != nil {
			return nil, err
		}
		if !validRuntimeEnvironmentName(name) {
			return nil, errors.New("invalid environment variable name")
		}
		value, err := decryptEnvironmentValue(ciphertext, w.cfg.hostingEncryptionKey)
		if err != nil {
			return nil, err
		}
		if strings.IndexByte(value, 0) >= 0 {
			return nil, errors.New("invalid environment variable value")
		}
		result = append(result, name+"="+value)
	}
	return result, rows.Err()
}

func (w *worker) runBuild(ctx context.Context, op operation, volume string) error {
	site := op.Site
	commands := make([]string, 0, 2)
	if strings.TrimSpace(site.InstallCommand) != "" {
		commands = append(commands, strings.TrimSpace(site.InstallCommand))
	}
	if strings.TrimSpace(site.BuildCommand) != "" {
		commands = append(commands, strings.TrimSpace(site.BuildCommand))
	}
	if len(commands) == 0 {
		return nil
	}
	if effectiveProjectType(site) != "node" {
		return fail("build_not_supported", "คำสั่ง Build ใช้ได้กับ Node.js เท่านั้น", false, nil)
	}
	image := "node:22-alpine"
	if err := w.docker.pullImage(ctx, image); err != nil {
		return fail("builder_image_failed", "ไม่สามารถเตรียมระบบ Build ได้", true, err)
	}
	command := strings.Join(commands, " && ")
	logs, err := w.docker.runBuildContainer(ctx, runtimeBuildName(site.PublicID), image, volume, command, site)
	if logs != "" {
		w.runtimeLog(ctx, op.SiteID, op.OperationID, "stdout", logs)
	}
	if err != nil {
		return fail("build_failed", "Build เว็บไซต์ไม่สำเร็จ กรุณาตรวจสอบ Runtime logs", false, err)
	}
	return nil
}

func (w *worker) stopRuntime(ctx context.Context, op operation, expired bool) error {
	if err := w.cleanupRuntime(ctx, op.Site, false); err != nil {
		return fail("container_stop_failed", "ไม่สามารถหยุดเว็บไซต์ได้", true, err)
	}
	status := "stopped"
	if expired || metadataString(op.Metadata, "expiryAction") != "" {
		status = "expired"
	}
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_sites
		SET status=$2,health_status='stopped',health_checked_at=NOW(),
		    runtime_container_id='',runtime_port=NULL,updated_at=NOW()
		WHERE id=$1
	`, op.SiteID, status)
	return err
}

func (w *worker) deleteRuntime(ctx context.Context, op operation) error {
	if err := w.cleanupRuntime(ctx, op.Site, true); err != nil {
		return fail("runtime_delete_failed", "ล้างทรัพยากรเว็บไซต์ไม่สำเร็จ", true, err)
	}
	if err := w.deleteTenantDatabases(ctx, op.SiteID); err != nil {
		return fail("database_cleanup_failed", "ไม่สามารถล้างฐานข้อมูลของเว็บไซต์ได้", true, err)
	}
	prefix := fmt.Sprintf("deployments/%d/", op.SiteID)
	for object := range w.store.ListObjects(ctx, w.cfg.s3Bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if object.Err != nil {
			return fail("deployment_cleanup_failed", "ล้างไฟล์ Deployment ไม่สำเร็จ", true, object.Err)
		}
		if err := w.store.RemoveObject(ctx, w.cfg.s3Bucket, object.Key, minio.RemoveObjectOptions{}); err != nil {
			return fail("deployment_cleanup_failed", "ล้างไฟล์ Deployment ไม่สำเร็จ", true, err)
		}
	}
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_sites SET runtime_container_id='',runtime_port=NULL,
		       health_status='stopped',health_checked_at=NOW(),updated_at=NOW()
		WHERE id=$1
	`, op.SiteID)
	return err
}

func (w *worker) deleteTenantDatabases(ctx context.Context, siteID int64) error {
	rows, err := w.db.Query(ctx, `
		SELECT db_name,db_user FROM hosting_databases
		WHERE site_id=$1 AND engine='mysql' AND status <> 'deleted'
	`, siteID)
	if err != nil {
		return err
	}
	type database struct{ name, user string }
	items := make([]database, 0)
	for rows.Next() {
		var item database
		if err := rows.Scan(&item.name, &item.user); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	if len(items) == 0 {
		return nil
	}
	var mysqlAdmin *sql.DB
	defer func() {
		if mysqlAdmin != nil {
			_ = mysqlAdmin.Close()
		}
	}()
	for _, item := range items {
		if !validTenantIdentifier(item.name) || !validTenantIdentifier(item.user) {
			return errors.New("invalid tenant database identifier")
		}
		if mysqlAdmin == nil {
			mysqlAdmin, err = sql.Open("mysql", w.cfg.tenantMySQLDSN)
			if err != nil {
				return err
			}
			if err := mysqlAdmin.PingContext(ctx); err != nil {
				return err
			}
		}
		if _, err := mysqlAdmin.ExecContext(ctx, "DROP DATABASE IF EXISTS `"+item.name+"`"); err != nil {
			return err
		}
		if _, err := mysqlAdmin.ExecContext(ctx, "DROP USER IF EXISTS '"+item.user+"'@'%'"); err != nil {
			return err
		}
	}
	_, err = w.db.Exec(ctx, `
		UPDATE hosting_databases SET status='deleted',updated_at=NOW()
		WHERE site_id=$1 AND engine='mysql'
	`, siteID)
	return err
}

func validTenantIdentifier(value string) bool {
	if len(value) < 8 || len(value) > 63 || (!strings.HasPrefix(value, "nxdb_") && !strings.HasPrefix(value, "nxu_")) {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_' {
			continue
		}
		return false
	}
	return true
}

func (w *worker) cleanupRuntime(ctx context.Context, site site, removeWorkspace bool) error {
	name := runtimeContainerName(site.PublicID)
	network := runtimeNetworkName(site.PublicID)
	volume := runtimeVolumeName(site.PublicID)

	var problems []error
	codeName := "nexora-code-" + site.PublicID
	if _, err := w.docker.inspectContainer(ctx, codeName); err == nil {
		if err := w.docker.removeContainer(ctx, codeName, true); err != nil && !errors.Is(err, errDockerNotFound) {
			problems = append(problems, err)
		}
	} else if !errors.Is(err, errDockerNotFound) {
		problems = append(problems, err)
	}
	if _, err := w.docker.inspectContainer(ctx, name); err == nil {
		if err := w.docker.removeContainer(ctx, name, true); err != nil && !errors.Is(err, errDockerNotFound) {
			problems = append(problems, err)
		}
	} else if !errors.Is(err, errDockerNotFound) {
		problems = append(problems, err)
	}
	if w.docker.networkExists(ctx, network) {
		if err := w.docker.disconnectNetwork(ctx, network, w.cfg.tenantDBContainer); err != nil &&
			!errors.Is(err, errDockerNotFound) && !errors.Is(err, errDockerConflict) {
			problems = append(problems, err)
		}
		if err := w.docker.disconnectNetwork(ctx, network, w.cfg.gatewayContainer); err != nil &&
			!errors.Is(err, errDockerNotFound) && !errors.Is(err, errDockerConflict) {
			problems = append(problems, err)
		}
		if err := w.docker.removeNetwork(ctx, network); err != nil &&
			!errors.Is(err, errDockerNotFound) && !errors.Is(err, errDockerConflict) {
			problems = append(problems, err)
		}
	}
	if removeWorkspace && w.docker.volumeExists(ctx, volume) {
		if err := w.docker.removeVolume(ctx, volume); err != nil &&
			!errors.Is(err, errDockerNotFound) && !errors.Is(err, errDockerConflict) {
			problems = append(problems, err)
		}
	}
	if err := w.releasePort(ctx, site.PublicID); err != nil {
		problems = append(problems, err)
	}
	return errors.Join(problems...)
}

func (w *worker) waitUntilHealthy(ctx context.Context, op operation) error {
	name := runtimeContainerName(op.Site.PublicID)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
	for {
		inspect, err := w.docker.inspectContainer(ctx, name)
		if err != nil {
			return fail("container_inspect_failed", "ไม่สามารถตรวจสอบสถานะเว็บไซต์ได้", true, err)
		}
		if !inspect.State.Running {
			logs, _ := w.docker.containerLogs(ctx, name, 80)
			if logs != "" {
				w.runtimeLog(ctx, op.SiteID, op.OperationID, "stderr", logs)
			}
			return fail("container_exited", "เว็บไซต์หยุดทำงานระหว่างเริ่มระบบ", false, nil)
		}
		health := inspect.State.Health.Status
		if health == "healthy" || health == "" {
			return w.markRunning(ctx, op, "healthy")
		}
		if health == "unhealthy" {
			return fail("health_check_failed", "เว็บไซต์ไม่ผ่าน Health check", false, nil)
		}
		select {
		case <-ctx.Done():
			return fail("operation_timeout", "การเริ่มเว็บไซต์ใช้เวลานานเกินกำหนด", true, ctx.Err())
		case <-deadline.C:
			return fail("health_check_timeout", "เว็บไซต์ยังไม่พร้อมตอบสนอง", true, nil)
		case <-ticker.C:
		}
	}
}

func (w *worker) markRunning(ctx context.Context, op operation, health string) error {
	if health == "" {
		health = "healthy"
	}
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_sites
		SET status='running',health_status=$2,health_checked_at=NOW(),updated_at=NOW()
		WHERE id=$1
	`, op.SiteID, health)
	return err
}

func (w *worker) reservePort(ctx context.Context, siteID int64) (int, error) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, portLockID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE hosting_port_leases
		SET state='released',released_at=NOW()
		WHERE state IN ('reserved','active') AND expires_at<=NOW()
	`); err != nil {
		return 0, err
	}
	var port int
	err = tx.QueryRow(ctx, `
		SELECT candidate
		FROM generate_series($1::int,$2::int) candidate
		WHERE NOT EXISTS (
		  SELECT 1 FROM hosting_port_leases lease
		  WHERE lease.port=candidate AND lease.state IN ('reserved','active')
		    AND lease.expires_at>NOW()
		)
		ORDER BY candidate
		LIMIT 1
	`, w.cfg.portMin, w.cfg.portMax).Scan(&port)
	if err != nil {
		return 0, err
	}
	token := randomHex(32)
	tokenHash := sha256.Sum256([]byte(token))
	_, err = tx.Exec(ctx, `
		INSERT INTO hosting_port_leases
		  (site_id,port,lease_token_hash,state,leased_at,expires_at,released_at)
		VALUES ($1,$2,$3,'reserved',NOW(),NOW()+$4::interval,NULL)
		ON CONFLICT (site_id) DO UPDATE
		SET port=EXCLUDED.port,lease_token_hash=EXCLUDED.lease_token_hash,state='reserved',
		    leased_at=NOW(),expires_at=EXCLUDED.expires_at,released_at=NULL
	`, siteID, port, hex.EncodeToString(tokenHash[:]), intervalString(w.cfg.leaseDuration))
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return port, nil
}

func (w *worker) activateLease(ctx context.Context, siteID int64) error {
	tag, err := w.db.Exec(ctx, `
		UPDATE hosting_port_leases
		SET state='active',expires_at=NOW()+$2::interval,released_at=NULL
		WHERE site_id=$1 AND state='reserved'
	`, siteID, intervalString(w.cfg.leaseDuration))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("reserved lease not found")
	}
	return nil
}

func (w *worker) releasePort(ctx context.Context, publicID string) error {
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_port_leases lease
		SET state='released',released_at=NOW(),expires_at=NOW()
		FROM hosting_sites site
		WHERE lease.site_id=site.id AND site.public_id=$1 AND lease.state<>'released'
	`, publicID)
	return err
}

func (w *worker) latestDeploymentKey(ctx context.Context, siteID int64) (string, error) {
	var key string
	err := w.db.QueryRow(ctx, `
		SELECT metadata->>'deploymentKey'
		FROM hosting_operations
		WHERE site_id=$1 AND metadata ? 'deploymentKey'
		ORDER BY id DESC LIMIT 1
	`, siteID).Scan(&key)
	if strings.TrimSpace(key) == "" && err == nil {
		err = pgx.ErrNoRows
	}
	return key, err
}

func (w *worker) completeOperation(ctx context.Context, op operation) error {
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_operations
		SET state='succeeded',phase='completed',finished_at=NOW(),
		    error_code='',error_message='',retryable=FALSE,updated_at=NOW()
		WHERE id=$1
	`, op.ID)
	return err
}

func (w *worker) retryOperation(ctx context.Context, op operation, failure *operationFailure) error {
	retryAt := time.Now().UTC().Add(time.Duration(op.Attempt*5) * time.Second).Format(time.RFC3339)
	_, err := w.db.Exec(ctx, `
		UPDATE hosting_operations
		SET state='queued',phase='retry_wait',attempt=attempt+1,finished_at=NULL,
		    error_code=$2,error_message=$3,retryable=TRUE,updated_at=NOW(),
		    metadata=jsonb_set(metadata,'{retryAt}',to_jsonb($4::text),true)
		WHERE id=$1
	`, op.ID, failure.code, failure.message, retryAt)
	return err
}

func (w *worker) failOperation(ctx context.Context, op operation, failure *operationFailure) error {
	tx, err := w.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE hosting_operations
		SET state='failed',phase='failed',finished_at=NOW(),error_code=$2,
		    error_message=$3,retryable=$4,updated_at=NOW()
		WHERE id=$1
	`, op.ID, failure.code, failure.message, failure.retryable); err != nil {
		return err
	}
	if op.Kind != "site.delete" {
		if _, err := tx.Exec(ctx, `
			UPDATE hosting_sites
			SET status='error',health_status='unhealthy',health_checked_at=NOW(),updated_at=NOW()
			WHERE id=$1 AND deleted_at IS NULL
		`, op.SiteID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (w *worker) runtimeLog(ctx context.Context, siteID int64, operationID, stream, message string) {
	if siteID == 0 {
		return
	}
	message = safeLogMessage(message)
	if message == "" {
		return
	}
	_, err := w.db.Exec(ctx, `
		INSERT INTO hosting_runtime_logs(site_id,operation_id,stream,message)
		VALUES ($1,NULLIF($2,''),$3,$4)
	`, siteID, operationID, stream, message)
	if err != nil {
		log.Printf("runtime log insert failed: %v", err)
	}
}

func (w *worker) captureLogs(ctx context.Context, op operation) {
	if op.Kind == "runtime.stop" || op.Kind == "site.delete" {
		return
	}
	logs, err := w.docker.containerLogs(ctx, runtimeContainerName(op.Site.PublicID), 120)
	if err == nil && logs != "" {
		w.runtimeLog(ctx, op.SiteID, op.OperationID, "stdout", logs)
	}
}

func (w *worker) monitor(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.healthInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.recoverTimedOutOperations(ctx)
			w.checkRunningSites(ctx)
		}
	}
}

func (w *worker) checkRunningSites(ctx context.Context) {
	rows, err := w.db.Query(ctx, `
		SELECT id,public_id,health_status FROM hosting_sites
		WHERE deleted_at IS NULL AND status='running'
	`)
	if err != nil {
		log.Printf("health scan failed: %v", err)
		return
	}
	defer rows.Close()
	type target struct {
		id       int64
		publicID string
		previous string
	}
	var targets []target
	for rows.Next() {
		var item target
		if rows.Scan(&item.id, &item.publicID, &item.previous) == nil {
			targets = append(targets, item)
		}
	}
	for _, target := range targets {
		network := runtimeNetworkName(target.publicID)
		if w.docker.networkExists(ctx, network) && !w.docker.networkHasContainer(ctx, network, w.cfg.gatewayContainer) {
			if err := w.docker.connectNetwork(ctx, network, w.cfg.gatewayContainer); err != nil {
				log.Printf("gateway network repair failed for site %s: %v", target.publicID, err)
			}
		}
		if w.docker.networkExists(ctx, network) && !w.docker.networkHasContainer(ctx, network, w.cfg.tenantDBContainer) {
			if err := w.docker.connectNetwork(ctx, network, w.cfg.tenantDBContainer); err != nil {
				log.Printf("database network repair failed for site %s: %v", target.publicID, err)
			}
		}
		inspect, inspectErr := w.docker.inspectContainer(ctx, runtimeContainerName(target.publicID))
		status := "unhealthy"
		siteStatus := "error"
		if inspectErr == nil && inspect.State.Running {
			status = inspect.State.Health.Status
			if status == "" || status == "starting" {
				status = "healthy"
			}
			if status == "healthy" {
				siteStatus = "running"
			}
		}
		_, _ = w.db.Exec(ctx, `
			UPDATE hosting_sites SET health_status=$2,status=$3,health_checked_at=NOW(),updated_at=NOW()
			WHERE id=$1
		`, target.id, status, siteStatus)
		if status != target.previous {
			w.runtimeLog(ctx, target.id, "", "health", "Health status: "+status)
		}
		if siteStatus == "running" {
			_, _ = w.db.Exec(ctx, `
				UPDATE hosting_port_leases SET expires_at=NOW()+$2::interval
				WHERE site_id=$1 AND state='active'
			`, target.id, intervalString(w.cfg.leaseDuration))
		}
	}
}

func (w *worker) expirationLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.enqueueExpiredSites(ctx); err != nil {
				log.Printf("expiration scan failed: %v", err)
			}
		}
	}
}

func (w *worker) enqueueExpiredSites(ctx context.Context) error {
	rows, err := w.db.Query(ctx, `
		SELECT id,public_id,owner_user_id,expiry_action,expires_at
		FROM hosting_sites site
		WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at<=NOW()
		  AND status<>'expired'
		  AND NOT EXISTS (
		    SELECT 1 FROM hosting_operations active
		    WHERE active.site_id=site.id AND active.state IN ('queued','running')
		  )
		ORDER BY id LIMIT 100
	`)
	if err != nil {
		return err
	}
	type expiredSite struct {
		id        int64
		publicID  string
		ownerID   int64
		action    string
		expiresAt time.Time
	}
	var items []expiredSite
	for rows.Next() {
		var item expiredSite
		if err := rows.Scan(&item.id, &item.publicID, &item.ownerID, &item.action, &item.expiresAt); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		kind := "runtime.stop"
		if item.action == "delete" {
			kind = "site.delete"
		}
		key := "expiry:" + item.publicID + ":" + item.expiresAt.UTC().Format("200601021504")
		digest := sha256.Sum256([]byte(item.publicID + ":" + item.action))
		metadata, _ := json.Marshal(map[string]any{
			"sitePublicId": item.publicID,
			"expiryAction": item.action,
		})
		tx, beginErr := w.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
		if beginErr != nil {
			return beginErr
		}
		_, insertErr := tx.Exec(ctx, `
			INSERT INTO hosting_operations
			  (operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
			   started_at,timeout_seconds,error_code,error_message,retryable,metadata)
			VALUES ($1,$2,$3,$4,$5,$6,'queued','pending',NOW(),600,'','',TRUE,$7)
			ON CONFLICT DO NOTHING
		`, randomHex(16), item.id, item.ownerID, kind, key, hex.EncodeToString(digest[:]), metadata)
		if insertErr == nil && item.action == "delete" {
			_, insertErr = tx.Exec(ctx, `UPDATE hosting_sites SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1`, item.id)
		}
		if insertErr != nil {
			_ = tx.Rollback(ctx)
			return insertErr
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (w *worker) recoverTimedOutOperations(ctx context.Context) {
	rows, err := w.db.Query(ctx, `
		UPDATE hosting_operations
		SET state='failed',phase='timeout',finished_at=NOW(),error_code='worker_timeout',
		    error_message='การทำงานหยุดลงเนื่องจากใช้เวลานานเกินกำหนด',
		    retryable=TRUE,updated_at=NOW()
		WHERE state='running'
		  AND started_at + make_interval(secs=>timeout_seconds) < NOW()
		RETURNING site_id
	`)
	if err != nil {
		log.Printf("operation timeout recovery failed: %v", err)
		return
	}
	defer rows.Close()
	var siteIDs []int64
	for rows.Next() {
		var siteID int64
		if rows.Scan(&siteID) == nil {
			siteIDs = append(siteIDs, siteID)
		}
	}
	for _, siteID := range siteIDs {
		_, _ = w.db.Exec(ctx, `
			UPDATE hosting_sites
			SET status='error',health_status='unhealthy',health_checked_at=NOW(),updated_at=NOW()
			WHERE id=$1 AND deleted_at IS NULL
		`, siteID)
	}
}

func validateRuntimeCommands(site site) error {
	allowedInstall := map[string]bool{
		"": true, "npm ci": true, "npm install": true,
		"pnpm install": true, "pnpm install --frozen-lockfile": true,
		"yarn install": true, "yarn install --frozen-lockfile": true,
	}
	allowedBuild := map[string]bool{
		"": true, "npm run build": true, "pnpm run build": true, "yarn build": true,
	}
	allowedStart := map[string]bool{
		"": true, "npm start": true, "pnpm start": true, "yarn start": true,
		"node server.js": true, "node index.js": true, "node dist/index.js": true,
	}
	if !allowedInstall[strings.TrimSpace(site.InstallCommand)] ||
		!allowedBuild[strings.TrimSpace(site.BuildCommand)] ||
		!allowedStart[strings.TrimSpace(site.StartCommand)] {
		return errors.New("command is outside the allowlist")
	}
	return nil
}

func effectiveProjectType(site site) string {
	if site.ProjectType == "auto" && site.DetectedType != "" {
		return site.DetectedType
	}
	if site.ProjectType == "auto" {
		return "static"
	}
	return site.ProjectType
}

func normalizeFailure(err error) *operationFailure {
	var failure *operationFailure
	if errors.As(err, &failure) {
		return failure
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fail("operation_timeout", "การทำงานใช้เวลานานเกินกำหนด", true, err)
	}
	return fail("runtime_error", "Runtime ทำงานไม่สำเร็จ", true, err)
}

func fail(code, message string, retryable bool, cause error) *operationFailure {
	return &operationFailure{code: code, message: message, retryable: retryable, cause: cause}
}

func metadataString(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}

func safeLogMessage(value string) string {
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 32 {
			return r
		}
		return -1
	}, value)
	value = strings.TrimSpace(value)
	if len(value) > 4000 {
		value = value[:4000]
	}
	return value
}

func runtimeContainerName(publicID string) string { return "nexora-site-" + publicID }
func runtimeNetworkName(publicID string) string   { return "nexora-net-" + publicID }
func runtimeVolumeName(publicID string) string    { return "nexora-workspace-" + publicID }
func runtimeBuildName(publicID string) string     { return "nexora-build-" + publicID }

func intervalString(value time.Duration) string {
	return fmt.Sprintf("%d seconds", int(value.Seconds()))
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buffer)
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "true" || value == "1" || value == "yes"
}

func (w *worker) ensureCodeServerContainer(ctx context.Context, publicID string) error {
	name := "nexora-code-" + publicID
	network := runtimeNetworkName(publicID)
	volume := runtimeVolumeName(publicID)

	inspect, err := w.docker.inspectContainer(ctx, name)
	if err == nil {
		if !inspect.State.Running {
			return w.docker.startContainer(ctx, name)
		}
		return nil
	}
	if !errors.Is(err, errDockerNotFound) {
		return err
	}

	_, err = w.docker.createCodeServerContainer(ctx, name, network, volume)
	if err != nil {
		return err
	}
	return w.docker.startContainer(ctx, name)
}
