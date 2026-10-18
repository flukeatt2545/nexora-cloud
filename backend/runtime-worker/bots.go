package main

// Discord bots: one container per bot with no port, on a shared bridge network that may reach
// the internet but not the platform (see deploy/bot-egress-firewall.sh). Jobs come from
// bot_operations; the monitor copies container output into bot_runtime_logs and stops bots that
// keep crashing or outgrow their disk quota.

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

const (
	botNetworkName      = "nexora-bots"
	botBridgeName       = "nxbots0"
	botCrashLimit       = 5
	botCrashWindow      = 5 * time.Minute
	botLogKeep          = 3000
	botStartupWatch     = 6 * time.Second
	botMonitorInterval  = 5 * time.Second
	botHousekeepEvery   = 10 * time.Minute
	botBuildMemoryFloor = int64(512)
)

type botOperation struct {
	ID          int64
	OperationID string
	BotID       int64
	Kind        string
	Attempt     int
	Timeout     int
	Bot         botSpec
}

type botSpec struct {
	ID                int64
	PublicID          string
	Runtime           string
	EntryFile         string
	StartMode         string
	SourceKey         string
	DeployedSourceKey string
	CPUMillicores     int64
	MemoryMB          int64
	ProcessLimit      int64
	DiskLimitMB       int64
	Deleted           bool
}

type botLogLine struct {
	Stream string
	At     time.Time
	Text   string
}

type botState struct {
	mu       sync.Mutex
	crashes  map[int64][]time.Time
	secrets  map[int64][]string
	lastTidy time.Time
}

func botContainerName(publicID string) string { return "nexora-bot-" + publicID }
func botSourceVolume(publicID string) string  { return "nexora-botsrc-" + publicID }
func botDataVolume(publicID string) string    { return "nexora-botdata-" + publicID }
func botBuildName(publicID string) string     { return "nexora-botbuild-" + publicID }

func botImage(runtime string) string {
	if runtime == "python" {
		return "python:3.12-slim"
	}
	return "node:22-alpine"
}

// ---- Loop ----------------------------------------------------------------------------------

func (w *worker) botLoop(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.pollInterval)
	defer ticker.Stop()
	for {
		worked, err := w.processBotOperation(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("bot operation poll failed: %v", err)
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

func (w *worker) processBotOperation(ctx context.Context) (bool, error) {
	op, err := w.claimBotOperation(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	timeout := time.Duration(op.Timeout) * time.Second
	if timeout < time.Minute {
		timeout = 15 * time.Minute
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	runErr := w.executeBotOperation(runCtx, op)
	if runErr == nil {
		_, err := w.db.Exec(ctx, `
			UPDATE bot_operations SET state='succeeded',phase='completed',finished_at=NOW(),
			       error_code='',error_message='',updated_at=NOW()
			WHERE id=$1
		`, op.ID)
		return true, err
	}
	failure := normalizeFailure(runErr)
	log.Printf("bot operation %s (%s) failed: %v", op.OperationID, op.Kind, runErr)
	if failure.retryable && op.Attempt < maxAttempts && ctx.Err() == nil {
		retryAt := time.Now().UTC().Add(time.Duration(op.Attempt*5) * time.Second).Format(time.RFC3339)
		_, err := w.db.Exec(ctx, `
			UPDATE bot_operations SET state='queued',phase='retry_wait',attempt=attempt+1,
			       error_code=$2,error_message=$3,updated_at=NOW(),
			       metadata=jsonb_set(metadata,'{retryAt}',to_jsonb($4::text),true)
			WHERE id=$1
		`, op.ID, failure.code, failure.message, retryAt)
		w.botLog(ctx, op.BotID, "system", fmt.Sprintf("%s ระบบจะลองใหม่ (%d/%d)", failure.message, op.Attempt+1, maxAttempts))
		return true, err
	}
	if _, err := w.db.Exec(ctx, `
		UPDATE bot_operations SET state='failed',phase='failed',finished_at=NOW(),
		       error_code=$2,error_message=$3,updated_at=NOW()
		WHERE id=$1
	`, op.ID, failure.code, failure.message); err != nil {
		return true, err
	}
	if op.Kind != "bot.delete" {
		status := "error"
		if failure.code == "bot_exited" {
			status = "crashed"
		}
		_, _ = w.db.Exec(ctx, `
			UPDATE bot_apps SET status=$2,status_message=$3,stopped_at=NOW(),updated_at=NOW()
			WHERE id=$1 AND deleted_at IS NULL
		`, op.BotID, status, failure.message)
		w.botLog(ctx, op.BotID, "stderr", failure.message)
	}
	return true, nil
}

func (w *worker) claimBotOperation(ctx context.Context) (botOperation, error) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return botOperation{}, err
	}
	defer tx.Rollback(ctx)
	var op botOperation
	err = tx.QueryRow(ctx, `
		SELECT o.id,o.operation_id,o.bot_id,o.kind,o.attempt,o.timeout_seconds,
		       b.public_id,b.runtime,b.entry_file,b.start_mode,b.source_key,b.deployed_source_key,
		       b.cpu_millicores,b.memory_mb,b.process_limit,b.disk_limit_mb,(b.deleted_at IS NOT NULL)
		FROM bot_operations o
		JOIN bot_apps b ON b.id=o.bot_id
		WHERE o.state='queued'
		  AND COALESCE(NULLIF(o.metadata->>'retryAt','')::timestamptz, NOW()) <= NOW()
		ORDER BY o.id
		FOR UPDATE OF o SKIP LOCKED
		LIMIT 1
	`).Scan(
		&op.ID, &op.OperationID, &op.BotID, &op.Kind, &op.Attempt, &op.Timeout,
		&op.Bot.PublicID, &op.Bot.Runtime, &op.Bot.EntryFile, &op.Bot.StartMode, &op.Bot.SourceKey, &op.Bot.DeployedSourceKey,
		&op.Bot.CPUMillicores, &op.Bot.MemoryMB, &op.Bot.ProcessLimit, &op.Bot.DiskLimitMB, &op.Bot.Deleted,
	)
	if err != nil {
		return botOperation{}, err
	}
	op.Bot.ID = op.BotID
	if _, err := tx.Exec(ctx, `
		UPDATE bot_operations SET state='running',phase='claimed',started_at=NOW(),updated_at=NOW(),
		       metadata=metadata-'retryAt'
		WHERE id=$1
	`, op.ID); err != nil {
		return botOperation{}, err
	}
	return op, tx.Commit(ctx)
}

func (w *worker) executeBotOperation(ctx context.Context, op botOperation) error {
	if op.Bot.Deleted && op.Kind != "bot.delete" {
		return fail("bot_deleted", "บอทตัวนี้ถูกลบแล้ว", false, nil)
	}
	switch op.Kind {
	case "bot.start", "bot.restart":
		return w.startBot(ctx, op, false)
	case "bot.deploy":
		return w.startBot(ctx, op, true)
	case "bot.stop":
		return w.stopBot(ctx, op)
	case "bot.delete":
		return w.deleteBot(ctx, op)
	default:
		return fail("unsupported_operation", "ระบบยังไม่รองรับคำสั่งนี้", false, nil)
	}
}

func (w *worker) setBotPhase(ctx context.Context, op botOperation, status, phase string) {
	_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET status=$2,status_message='',updated_at=NOW() WHERE id=$1`, op.BotID, status)
	_, _ = w.db.Exec(ctx, `UPDATE bot_operations SET phase=$2,updated_at=NOW() WHERE id=$1`, op.ID, phase)
}

// ---- Start / stop / delete -----------------------------------------------------------------

func (w *worker) startBot(ctx context.Context, op botOperation, rebuild bool) error {
	bot := op.Bot
	if bot.SourceKey == "" {
		return fail("bot_no_source", "ยังไม่มีโค้ดของบอท อัปโหลดไฟล์หรือดึงจาก GitHub ก่อน", false, nil)
	}
	command, err := botCommand(bot)
	if err != nil {
		return fail("bot_entry_invalid", "ไฟล์เริ่มต้นไม่ถูกต้อง แก้ในแท็บตั้งค่า", false, err)
	}
	w.setBotPhase(ctx, op, "starting", "preparing")
	if err := w.ensureBotNetwork(ctx); err != nil {
		return fail("bot_network_failed", "เตรียมเครือข่ายของบอทไม่สำเร็จ", true, err)
	}
	name := botContainerName(bot.PublicID)
	if err := w.removeBotContainer(ctx, bot); err != nil {
		return fail("bot_cleanup_failed", "ปิดบอทตัวเดิมไม่สำเร็จ", true, err)
	}

	source := botSourceVolume(bot.PublicID)
	if rebuild || bot.DeployedSourceKey != bot.SourceKey || !w.docker.volumeExists(ctx, source) {
		w.setBotPhase(ctx, op, "building", "installing")
		if err := w.buildBot(ctx, op, source); err != nil {
			return err
		}
	}
	data := botDataVolume(bot.PublicID)
	if !w.docker.volumeExists(ctx, data) {
		if err := w.docker.createVolume(ctx, data); err != nil {
			return fail("bot_volume_failed", "สร้างที่เก็บข้อมูลของบอทไม่สำเร็จ", true, err)
		}
		if err := w.docker.populateVolume(ctx, data, emptyTar()); err != nil {
			return fail("bot_volume_failed", "เตรียมที่เก็บข้อมูลของบอทไม่สำเร็จ", true, err)
		}
	}

	image := botImage(bot.Runtime)
	if err := w.docker.pullImage(ctx, image); err != nil {
		return fail("image_pull_failed", "เตรียม "+image+" ไม่สำเร็จ", true, err)
	}
	environment, secrets, err := w.loadBotEnvironment(ctx, bot.ID)
	if err != nil {
		return fail("environment_unavailable", "อ่านตัวแปรลับของบอทไม่สำเร็จ", false, err)
	}
	w.rememberBotSecrets(bot.ID, secrets)
	w.setBotPhase(ctx, op, "starting", "starting")
	containerID, err := w.docker.createBotContainer(ctx, name, image, command, append(botBaseEnvironment(bot.Runtime), environment...), source, data, bot)
	if err != nil {
		return fail("container_create_failed", "สร้าง container ของบอทไม่สำเร็จ", true, err)
	}
	cursor := time.Now().UTC().Add(-time.Second).Format(time.RFC3339Nano)
	if _, err := w.db.Exec(ctx, `
		UPDATE bot_apps SET container_id=$2,started_at=NOW(),stopped_at=NULL,restart_count=0,last_exit_code=NULL,
		       log_cursor=$3,updated_at=NOW()
		WHERE id=$1
	`, bot.ID, containerID, cursor); err != nil {
		return fail("runtime_state_failed", "บันทึกสถานะบอทไม่สำเร็จ", true, err)
	}
	w.clearBotCrashes(bot.ID)
	if err := w.docker.startContainer(ctx, name); err != nil {
		return fail("container_start_failed", "เปิด container ของบอทไม่สำเร็จ", true, err)
	}
	w.botLog(ctx, bot.ID, "system", "เปิดบอทแล้ว")

	// A wrong token or a missing package ends the process within a few seconds; catch it here so
	// the owner sees why instead of a bot that says it is running.
	select {
	case <-ctx.Done():
		return fail("operation_timeout", "เปิดบอทนานเกินกำหนด", true, ctx.Err())
	case <-time.After(botStartupWatch):
	}
	w.collectBotLogs(ctx, bot.ID, bot.PublicID)
	inspect, err := w.docker.inspectContainer(ctx, name)
	if err != nil {
		return fail("container_inspect_failed", "ตรวจสถานะบอทไม่สำเร็จ", true, err)
	}
	if !inspect.State.Running {
		_ = w.docker.removeContainer(ctx, name, true)
		_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET last_exit_code=$2,container_id='' WHERE id=$1`, bot.ID, inspect.State.ExitCode)
		return fail("bot_exited", fmt.Sprintf("บอทหยุดทำงานทันทีหลังเปิด (รหัส %d) ดูสาเหตุในบรรทัดสีแดงของคอนโซล", inspect.State.ExitCode), false, nil)
	}
	if err := w.docker.setRestartPolicy(ctx, name, "unless-stopped"); err != nil {
		return fail("container_update_failed", "ตั้งให้บอทเปิดใหม่เองเมื่อล่มไม่สำเร็จ", true, err)
	}
	_, err = w.db.Exec(ctx, `UPDATE bot_apps SET status='running',status_message='',updated_at=NOW() WHERE id=$1`, bot.ID)
	return err
}

func (w *worker) buildBot(ctx context.Context, op botOperation, source string) error {
	bot := op.Bot
	archive, names, err := w.botArchive(ctx, bot)
	if err != nil {
		return err
	}
	has := map[string]bool{}
	for _, name := range names {
		has[name] = true
	}
	if bot.StartMode == "entry" && !has[strings.ToLower(bot.EntryFile)] {
		return fail("bot_entry_missing", "ไม่พบไฟล์ "+bot.EntryFile+" ในโค้ด เลือกไฟล์เริ่มต้นใหม่ในแท็บตั้งค่า", false, nil)
	}
	if bot.StartMode == "npm_start" && !has["package.json"] {
		return fail("bot_entry_missing", "สั่งรันด้วย npm start แต่ไม่พบ package.json", false, nil)
	}
	w.botLog(ctx, bot.ID, "system", "กำลังเตรียมโค้ด")
	if w.docker.volumeExists(ctx, source) {
		if err := w.docker.removeVolume(ctx, source); err != nil && !errors.Is(err, errDockerNotFound) {
			return fail("bot_volume_failed", "ล้างโค้ดชุดเดิมไม่สำเร็จ", true, err)
		}
	}
	if err := w.docker.createVolume(ctx, source); err != nil {
		return fail("bot_volume_failed", "สร้างที่เก็บโค้ดไม่สำเร็จ", true, err)
	}
	if err := w.docker.populateVolume(ctx, source, archive); err != nil {
		return fail("bot_volume_failed", "คัดลอกโค้ดไม่สำเร็จ", true, err)
	}

	install := ""
	switch {
	case bot.Runtime == "node" && has["package.json"]:
		install = "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi"
		w.botLog(ctx, bot.ID, "system", "กำลังติดตั้งแพ็กเกจจาก package.json")
	case bot.Runtime == "python" && has["requirements.txt"]:
		install = "pip install --quiet --no-cache-dir --disable-pip-version-check --progress-bar off --target /workspace/.deps -r requirements.txt"
		w.botLog(ctx, bot.ID, "system", "กำลังติดตั้งแพ็กเกจจาก requirements.txt")
	}
	if install != "" {
		image := botImage(bot.Runtime)
		if err := w.docker.pullImage(ctx, image); err != nil {
			return fail("image_pull_failed", "เตรียม "+image+" ไม่สำเร็จ", true, err)
		}
		logs, err := w.docker.runBotBuild(ctx, botBuildName(bot.PublicID), image, source, install, botBaseEnvironment(bot.Runtime), bot)
		if logs != "" {
			w.botLogBlock(ctx, bot.ID, "stdout", logs)
		}
		if err != nil {
			if ctx.Err() != nil {
				return fail("build_timeout", "ติดตั้งแพ็กเกจนานเกินกำหนด", false, err)
			}
			return fail("build_failed", "ติดตั้งแพ็กเกจไม่ผ่าน ดูข้อความด้านบนในคอนโซล", false, err)
		}
		w.botLog(ctx, bot.ID, "system", "ติดตั้งแพ็กเกจเสร็จแล้ว")
	}
	_, err = w.db.Exec(ctx, `UPDATE bot_apps SET deployed_source_key=$2,updated_at=NOW() WHERE id=$1`, bot.ID, bot.SourceKey)
	return err
}

func (w *worker) botArchive(ctx context.Context, bot botSpec) ([]byte, []string, error) {
	if !strings.HasPrefix(bot.SourceKey, fmt.Sprintf("bots/%d/", bot.ID)) || !strings.HasSuffix(bot.SourceKey, ".zip") {
		return nil, nil, fail("bot_source_invalid", "ไฟล์โค้ดของบอทไม่ถูกต้อง", false, nil)
	}
	object, err := w.store.GetObject(ctx, w.cfg.s3Bucket, bot.SourceKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, nil, fail("bot_source_download_failed", "โหลดโค้ดของบอทไม่สำเร็จ", true, err)
	}
	defer object.Close()
	data, err := io.ReadAll(io.LimitReader(object, 64*1024*1024))
	if err != nil {
		return nil, nil, fail("bot_source_download_failed", "โหลดโค้ดของบอทไม่สำเร็จ", true, err)
	}
	limit := bot.DiskLimitMB * 1024 * 1024
	if limit <= 0 || limit > maxDeploymentUncompressed {
		limit = maxDeploymentUncompressed
	}
	archive, names, err := zipToSafeTar(data, limit)
	if err != nil {
		return nil, nil, fail("bot_source_unsafe", "โค้ดของบอทมีไฟล์ที่ใช้ไม่ได้ หรือใหญ่เกินโควตาดิสก์", false, err)
	}
	return archive, names, nil
}

func (w *worker) removeBotContainer(ctx context.Context, bot botSpec) error {
	name := botContainerName(bot.PublicID)
	if _, err := w.docker.inspectContainer(ctx, name); err != nil {
		if errors.Is(err, errDockerNotFound) {
			return nil
		}
		return err
	}
	_ = w.docker.stopContainer(ctx, name, 10)
	w.collectBotLogs(ctx, bot.ID, bot.PublicID)
	if err := w.docker.removeContainer(ctx, name, true); err != nil && !errors.Is(err, errDockerNotFound) {
		return err
	}
	return nil
}

func (w *worker) stopBot(ctx context.Context, op botOperation) error {
	if err := w.removeBotContainer(ctx, op.Bot); err != nil {
		return fail("bot_stop_failed", "ปิดบอทไม่สำเร็จ", true, err)
	}
	w.botLog(ctx, op.BotID, "system", "ปิดบอทแล้ว")
	_, err := w.db.Exec(ctx, `
		UPDATE bot_apps SET status='stopped',status_message='',container_id='',stopped_at=NOW(),updated_at=NOW()
		WHERE id=$1
	`, op.BotID)
	return err
}

func (w *worker) deleteBot(ctx context.Context, op botOperation) error {
	if err := w.removeBotContainer(ctx, op.Bot); err != nil {
		return fail("bot_delete_failed", "ลบ container ของบอทไม่สำเร็จ", true, err)
	}
	_ = w.docker.removeContainer(ctx, botBuildName(op.Bot.PublicID), true)
	for _, volume := range []string{botSourceVolume(op.Bot.PublicID), botDataVolume(op.Bot.PublicID)} {
		if err := w.docker.removeVolume(ctx, volume); err != nil && !errors.Is(err, errDockerNotFound) {
			return fail("bot_delete_failed", "ลบไฟล์ของบอทไม่สำเร็จ", true, err)
		}
	}
	prefix := fmt.Sprintf("bots/%d/", op.BotID)
	for object := range w.store.ListObjects(ctx, w.cfg.s3Bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if object.Err != nil {
			return fail("bot_delete_failed", "ลบโค้ดของบอทไม่สำเร็จ", true, object.Err)
		}
		if err := w.store.RemoveObject(ctx, w.cfg.s3Bucket, object.Key, minio.RemoveObjectOptions{}); err != nil {
			return fail("bot_delete_failed", "ลบโค้ดของบอทไม่สำเร็จ", true, err)
		}
	}
	w.forgetBot(op.BotID)
	_, err := w.db.Exec(ctx, `DELETE FROM bot_runtime_logs WHERE bot_id=$1`, op.BotID)
	if err == nil {
		_, err = w.db.Exec(ctx, `
			UPDATE bot_apps SET status='stopped',container_id='',source_key='',deployed_source_key='',updated_at=NOW()
			WHERE id=$1
		`, op.BotID)
	}
	return err
}

// ---- Container spec ------------------------------------------------------------------------

// botCommand runs the entry file directly, never through a shell, so a file name cannot add
// commands.
func botCommand(bot botSpec) ([]string, error) {
	if bot.StartMode == "npm_start" {
		if bot.Runtime != "node" {
			return nil, errors.New("npm start needs node")
		}
		return []string{"npm", "start"}, nil
	}
	entry, err := safeArchivePath(bot.EntryFile)
	if err != nil || entry == "" || strings.HasPrefix(entry, "-") || strings.HasPrefix(entry, ".deps/") || strings.HasPrefix(entry, "node_modules/") {
		return nil, errors.New("unsafe entry file")
	}
	extension := strings.ToLower(path.Ext(entry))
	if bot.Runtime == "python" {
		if extension != ".py" {
			return nil, errors.New("python entry must be .py")
		}
		return []string{"python", "-u", entry}, nil
	}
	if extension != ".js" && extension != ".mjs" && extension != ".cjs" {
		return nil, errors.New("node entry must be .js")
	}
	return []string{"node", entry}, nil
}

func botBaseEnvironment(runtime string) []string {
	base := []string{
		"HOME=/tmp",
		"DATA_DIR=/data",
		"NODE_ENV=production",
		"npm_config_cache=/tmp/.npm",
		"npm_config_update_notifier=false",
		"PYTHONUNBUFFERED=1",
		"PYTHONDONTWRITEBYTECODE=1",
	}
	if runtime == "python" {
		base = append(base, "PYTHONPATH=/workspace/.deps")
	}
	return base
}

func botLabels(kind, publicID string) map[string]string {
	labels := runtimeLabels(kind)
	labels["com.nexora.bot"] = publicID
	return labels
}

func (d *dockerClient) createBotContainer(ctx context.Context, name, image string, command, environment []string, source, data string, bot botSpec) (string, error) {
	memory := bot.MemoryMB * 1024 * 1024
	body := map[string]any{
		"Image":      image,
		"Hostname":   "bot-" + bot.PublicID[:12],
		"User":       "1000:1000",
		"WorkingDir": "/workspace",
		"Cmd":        command,
		"Env":        environment,
		"Labels":     botLabels("discord-bot", bot.PublicID),
		"HostConfig": map[string]any{
			"Binds":          []string{source + ":/workspace:rw", data + ":/data:rw"},
			"NetworkMode":    botNetworkName,
			"ReadonlyRootfs": true,
			"CapDrop":        []string{"ALL"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"PidsLimit":      bot.ProcessLimit,
			"Memory":         memory,
			"MemorySwap":     memory,
			"NanoCpus":       bot.CPUMillicores * 1_000_000,
			"Tmpfs":          map[string]string{"/tmp": "rw,noexec,nosuid,nodev,size=64m,mode=1777"},
			// No restarts during the startup check, so a bot that fails at once reports its real exit
			// code; startBot switches this to unless-stopped once the bot has stayed up.
			"RestartPolicy": map[string]any{"Name": "no"},
			"LogConfig":     map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "5m", "max-file": "2"}},
			"Ulimits":       []map[string]any{{"Name": "nofile", "Soft": 4096, "Hard": 4096}},
			"AutoRemove":    false,
		},
		"NetworkingConfig": map[string]any{
			"EndpointsConfig": map[string]any{botNetworkName: map[string]any{}},
		},
	}
	var response struct {
		ID string `json:"Id"`
	}
	err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(name), body, &response, http.StatusCreated)
	return response.ID, err
}

// runBotBuild installs packages into the source volume. It runs on the bot network so the same
// firewall applies to install scripts as to the bot itself.
func (d *dockerClient) runBotBuild(ctx context.Context, name, image, volume, command string, environment []string, bot botSpec) (string, error) {
	_ = d.removeContainer(context.Background(), name, true)
	memoryMB := bot.MemoryMB
	if memoryMB < botBuildMemoryFloor {
		memoryMB = botBuildMemoryFloor
	}
	memory := memoryMB * 1024 * 1024
	cpu := bot.CPUMillicores
	if cpu < 1000 {
		cpu = 1000
	}
	body := map[string]any{
		"Image":      image,
		"User":       "1000:1000",
		"WorkingDir": "/workspace",
		"Cmd":        []string{"sh", "-c", command},
		"Env":        append(environment, "CI=true"),
		"Labels":     botLabels("bot-builder", bot.PublicID),
		"HostConfig": map[string]any{
			"Binds":          []string{volume + ":/workspace:rw"},
			"NetworkMode":    botNetworkName,
			"ReadonlyRootfs": true,
			"CapDrop":        []string{"ALL"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"PidsLimit":      256,
			"Memory":         memory,
			"MemorySwap":     memory,
			"NanoCpus":       cpu * 1_000_000,
			"Tmpfs":          map[string]string{"/tmp": "rw,noexec,nosuid,nodev,size=256m,mode=1777"},
			"AutoRemove":     false,
		},
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(name), body, &created, http.StatusCreated); err != nil {
		return "", err
	}
	defer d.removeContainer(context.Background(), name, true)
	if err := d.startContainer(ctx, name); err != nil {
		return "", err
	}
	var wait struct {
		StatusCode int `json:"StatusCode"`
	}
	waitErr := d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/wait?condition=not-running", nil, &wait, http.StatusOK)
	if waitErr != nil {
		_ = d.stopContainer(context.Background(), name, 1)
	}
	logs, _ := d.containerLogs(context.Background(), name, 200)
	if waitErr != nil {
		return logs, waitErr
	}
	if wait.StatusCode != 0 {
		return logs, fmt.Errorf("install exited with code %d", wait.StatusCode)
	}
	return logs, nil
}

func (d *dockerClient) setRestartPolicy(ctx context.Context, name, policy string) error {
	body := map[string]any{"RestartPolicy": map[string]any{"Name": policy}}
	return d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/update", body, nil, http.StatusOK)
}

func (d *dockerClient) stopContainer(ctx context.Context, name string, seconds int) error {
	return d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/stop?t="+strconv.Itoa(seconds), nil, nil, http.StatusNoContent, http.StatusNotModified)
}

// ensureBotNetwork creates the shared bot network once. The fixed bridge name lets the host
// firewall match its traffic; containers on it cannot reach each other (icc off).
func (w *worker) ensureBotNetwork(ctx context.Context) error {
	if w.docker.networkExists(ctx, botNetworkName) {
		return nil
	}
	body := map[string]any{
		"Name":           botNetworkName,
		"CheckDuplicate": true,
		"Driver":         "bridge",
		"Internal":       false,
		"Attachable":     false,
		"EnableIPv6":     false,
		"IPAM": map[string]any{
			"Driver": "default",
			"Config": []map[string]string{{"Subnet": w.cfg.botSubnet}},
		},
		"Options": map[string]string{
			"com.docker.network.bridge.enable_icc": "false",
			"com.docker.network.bridge.name":       botBridgeName,
		},
		"Labels": runtimeLabels("bot-network"),
	}
	err := w.docker.request(ctx, http.MethodPost, "/v1.44/networks/create", body, nil, http.StatusCreated)
	if errors.Is(err, errDockerConflict) {
		return nil
	}
	return err
}

// emptyTar is a valid tar with no entries: populateVolume then only sets the owner of the volume.
func emptyTar() []byte {
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	_ = writer.Close()
	return buffer.Bytes()
}

// ---- Environment and secrets ---------------------------------------------------------------

func (w *worker) loadBotEnvironment(ctx context.Context, botID int64) ([]string, []string, error) {
	rows, err := w.db.Query(ctx, `
		SELECT name,value_ciphertext,is_secret FROM bot_environment_variables WHERE bot_id=$1 ORDER BY name
	`, botID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	environment := make([]string, 0)
	secrets := make([]string, 0)
	for rows.Next() {
		var name, ciphertext string
		var secret bool
		if err := rows.Scan(&name, &ciphertext, &secret); err != nil {
			return nil, nil, err
		}
		if !validRuntimeEnvironmentName(name) {
			continue
		}
		value, err := decryptEnvironmentValue(ciphertext, w.cfg.hostingEncryptionKey)
		if err != nil {
			return nil, nil, err
		}
		if strings.IndexByte(value, 0) >= 0 {
			return nil, nil, errors.New("invalid environment variable value")
		}
		environment = append(environment, name+"="+value)
		if secret && len(value) >= 8 {
			secrets = append(secrets, value)
		}
	}
	return environment, secrets, rows.Err()
}

func (w *worker) rememberBotSecrets(botID int64, secrets []string) {
	w.bots.mu.Lock()
	defer w.bots.mu.Unlock()
	w.bots.secrets[botID] = secrets
}

func (w *worker) botSecrets(ctx context.Context, botID int64) []string {
	w.bots.mu.Lock()
	secrets, known := w.bots.secrets[botID]
	w.bots.mu.Unlock()
	if known {
		return secrets
	}
	_, secrets, err := w.loadBotEnvironment(ctx, botID)
	if err != nil {
		return nil
	}
	w.rememberBotSecrets(botID, secrets)
	return secrets
}

func (w *worker) forgetBot(botID int64) {
	w.bots.mu.Lock()
	defer w.bots.mu.Unlock()
	delete(w.bots.secrets, botID)
	delete(w.bots.crashes, botID)
}

func (w *worker) clearBotCrashes(botID int64) {
	w.bots.mu.Lock()
	defer w.bots.mu.Unlock()
	delete(w.bots.crashes, botID)
}

// recordBotCrashes adds restarts seen now and reports how many fall inside the window.
func (w *worker) recordBotCrashes(botID int64, count int, now time.Time) int {
	w.bots.mu.Lock()
	defer w.bots.mu.Unlock()
	recent := make([]time.Time, 0, len(w.bots.crashes[botID])+count)
	for _, at := range w.bots.crashes[botID] {
		if now.Sub(at) < botCrashWindow {
			recent = append(recent, at)
		}
	}
	for index := 0; index < count; index++ {
		recent = append(recent, now)
	}
	w.bots.crashes[botID] = recent
	return len(recent)
}

// Discord bot tokens look like <base64 id>.<timestamp>.<hmac>; a bot that prints its own token
// (debug logging does) must not leave it in the console.
var discordTokenPattern = regexp.MustCompile(`[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}`)

func redactBotLog(text string, secrets []string) string {
	for _, secret := range secrets {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, "[ซ่อนค่าลับ]")
		}
	}
	return discordTokenPattern.ReplaceAllString(text, "[ซ่อนโทเคน]")
}

// ---- Logs ----------------------------------------------------------------------------------

func botLogText(value string) string {
	value = strings.ToValidUTF8(value, "")
	value = strings.Map(func(r rune) rune {
		if r == '\t' || r >= 32 && r != 127 {
			return r
		}
		return -1
	}, value)
	value = strings.TrimRight(value, " ")
	if utf8.RuneCountInString(value) > 4000 {
		value = string([]rune(value)[:4000])
	}
	return value
}

func (w *worker) botLog(ctx context.Context, botID int64, stream, message string) {
	message = botLogText(message)
	if message == "" {
		return
	}
	if _, err := w.db.Exec(ctx, `INSERT INTO bot_runtime_logs(bot_id,stream,message) VALUES ($1,$2,$3)`, botID, stream, message); err != nil {
		log.Printf("bot log insert failed: %v", err)
	}
}

// botLogBlock stores multi-line output (install logs) one line per row.
func (w *worker) botLogBlock(ctx context.Context, botID int64, stream, block string) {
	lines := make([]botLogLine, 0)
	now := time.Now().UTC()
	for _, line := range strings.Split(block, "\n") {
		// containerLogs keeps Docker's timestamp prefix.
		if _, text, ok := splitDockerTimestamp(line); ok {
			line = text
		}
		lines = append(lines, botLogLine{Stream: stream, At: now, Text: line})
	}
	w.insertBotLines(ctx, botID, lines, w.botSecrets(ctx, botID))
}

func (w *worker) insertBotLines(ctx context.Context, botID int64, lines []botLogLine, secrets []string) {
	streams := make([]string, 0, len(lines))
	messages := make([]string, 0, len(lines))
	times := make([]time.Time, 0, len(lines))
	for _, line := range lines {
		text := botLogText(redactBotLog(strings.TrimRight(line.Text, "\r"), secrets))
		if strings.TrimSpace(text) == "" {
			continue
		}
		streams = append(streams, line.Stream)
		messages = append(messages, text)
		times = append(times, line.At)
	}
	if len(messages) == 0 {
		return
	}
	if _, err := w.db.Exec(ctx, `
		INSERT INTO bot_runtime_logs(bot_id,stream,message,created_at)
		SELECT $1,s,m,t FROM unnest($2::text[],$3::text[],$4::timestamptz[]) AS x(s,m,t)
	`, botID, streams, messages, times); err != nil {
		log.Printf("bot log insert failed: %v", err)
	}
}

// collectBotLogs copies what the container printed since the stored cursor.
func (w *worker) collectBotLogs(ctx context.Context, botID int64, publicID string) {
	var cursorText string
	if err := w.db.QueryRow(ctx, `SELECT log_cursor FROM bot_apps WHERE id=$1`, botID).Scan(&cursorText); err != nil {
		return
	}
	cursor, _ := time.Parse(time.RFC3339Nano, cursorText)
	lines, err := w.docker.containerLogLines(ctx, botContainerName(publicID), cursor, 1000)
	if err != nil {
		return
	}
	fresh := make([]botLogLine, 0, len(lines))
	latest := cursor
	for _, line := range lines {
		if !line.At.After(cursor) {
			continue
		}
		fresh = append(fresh, line)
		if line.At.After(latest) {
			latest = line.At
		}
	}
	if len(fresh) == 0 {
		return
	}
	w.insertBotLines(ctx, botID, fresh, w.botSecrets(ctx, botID))
	_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET log_cursor=$2 WHERE id=$1`, botID, latest.UTC().Format(time.RFC3339Nano))
}

func (d *dockerClient) containerLogLines(ctx context.Context, name string, since time.Time, tail int) ([]botLogLine, error) {
	query := "stdout=1&stderr=1&timestamps=1&tail=" + strconv.Itoa(tail)
	if !since.IsZero() {
		query += "&since=" + strconv.FormatInt(since.Unix(), 10) + "." + fmt.Sprintf("%09d", since.Nanosecond())
	}
	var data []byte
	if err := d.requestRaw(ctx, http.MethodGet, "/v1.44/containers/"+url.PathEscape(name)+"/logs?"+query, nil, "", &data, http.StatusOK); err != nil {
		return nil, err
	}
	return decodeDockerLogLines(data), nil
}

// decodeDockerLogLines splits Docker's multiplexed log stream into lines, keeping which stream
// each line came from and its timestamp.
func decodeDockerLogLines(data []byte) []botLogLine {
	lines := make([]botLogLine, 0)
	add := func(stream string, payload []byte) {
		for _, raw := range strings.Split(strings.TrimRight(string(payload), "\n"), "\n") {
			at, text, ok := splitDockerTimestamp(raw)
			if !ok {
				if len(lines) > 0 {
					at = lines[len(lines)-1].At
				} else {
					at = time.Now().UTC()
				}
				text = raw
			}
			lines = append(lines, botLogLine{Stream: stream, At: at, Text: text})
		}
	}
	if len(data) < 8 || (data[0] != 1 && data[0] != 2) {
		if len(data) > 0 {
			add("stdout", data)
		}
		return lines
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		header := make([]byte, 8)
		if _, err := io.ReadFull(reader, header); err != nil {
			break
		}
		size := binary.BigEndian.Uint32(header[4:8])
		if size > 4*1024*1024 {
			break
		}
		payload := make([]byte, size)
		if _, err := io.ReadFull(reader, payload); err != nil {
			break
		}
		stream := "stdout"
		if header[0] == 2 {
			stream = "stderr"
		}
		add(stream, payload)
	}
	return lines
}

func splitDockerTimestamp(line string) (time.Time, string, bool) {
	stamp, text, found := strings.Cut(line, " ")
	if !found || len(stamp) < 20 || stamp[4] != '-' {
		return time.Time{}, line, false
	}
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return time.Time{}, line, false
	}
	return at.UTC(), text, true
}

// ---- Monitor -------------------------------------------------------------------------------

func (w *worker) botMonitor(ctx context.Context) {
	ticker := time.NewTicker(botMonitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.recoverTimedOutBotOperations(ctx)
			w.checkRunningBots(ctx)
			w.botHousekeeping(ctx)
		}
	}
}

type watchedBot struct {
	id           int64
	publicID     string
	restartCount int
	diskLimitMB  int64
}

func (w *worker) runningBots(ctx context.Context) []watchedBot {
	rows, err := w.db.Query(ctx, `
		SELECT b.id,b.public_id,b.restart_count,b.disk_limit_mb FROM bot_apps b
		WHERE b.deleted_at IS NULL AND b.status IN ('running','starting')
		  AND NOT EXISTS (SELECT 1 FROM bot_operations o WHERE o.bot_id=b.id AND o.state IN ('queued','running'))
	`)
	if err != nil {
		log.Printf("bot scan failed: %v", err)
		return nil
	}
	defer rows.Close()
	var bots []watchedBot
	for rows.Next() {
		var bot watchedBot
		if rows.Scan(&bot.id, &bot.publicID, &bot.restartCount, &bot.diskLimitMB) == nil {
			bots = append(bots, bot)
		}
	}
	return bots
}

func (w *worker) checkRunningBots(ctx context.Context) {
	now := time.Now()
	for _, bot := range w.runningBots(ctx) {
		name := botContainerName(bot.publicID)
		inspect, err := w.docker.inspectContainer(ctx, name)
		if errors.Is(err, errDockerNotFound) {
			w.markBotStopped(ctx, bot, "crashed", "ไม่พบ container ของบอท กดเปิดบอทอีกครั้ง", nil)
			continue
		}
		if err != nil {
			continue
		}
		w.collectBotLogs(ctx, bot.id, bot.publicID)
		if inspect.RestartCount > bot.restartCount {
			added := inspect.RestartCount - bot.restartCount
			// Once Docker has started the bot again, ExitCode is back to 0; it is only the
			// crash's code while the container waits to restart.
			var exitCode *int
			message := "บอทหยุดทำงาน ระบบเปิดให้ใหม่แล้ว"
			if !inspect.State.Running {
				code := inspect.State.ExitCode
				exitCode = &code
				message = fmt.Sprintf("บอทหยุดทำงาน (รหัส %d) ระบบกำลังเปิดให้ใหม่", code)
			}
			w.botLog(ctx, bot.id, "system", message)
			_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET restart_count=$2,last_exit_code=COALESCE($3,last_exit_code),updated_at=NOW() WHERE id=$1`, bot.id, inspect.RestartCount, exitCode)
			if w.recordBotCrashes(bot.id, added, now) >= botCrashLimit {
				_ = w.docker.stopContainer(ctx, name, 5)
				w.collectBotLogs(ctx, bot.id, bot.publicID)
				_ = w.docker.removeContainer(ctx, name, true)
				w.markBotStopped(ctx, bot, "crashed", fmt.Sprintf("บอทหยุดเองซ้ำ %d ครั้งใน 5 นาที ระบบปิดไว้ก่อน ดูสาเหตุในคอนโซลแล้วค่อยเปิดใหม่", botCrashLimit), exitCode)
				continue
			}
		}
		if !inspect.State.Running && !inspect.State.Restarting {
			exitCode := inspect.State.ExitCode
			_ = w.docker.removeContainer(ctx, name, true)
			w.markBotStopped(ctx, bot, "crashed", fmt.Sprintf("บอทหยุดทำงาน (รหัส %d)", exitCode), &exitCode)
			continue
		}
		if inspect.State.Running {
			_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET status='running' WHERE id=$1 AND status='starting'`, bot.id)
		}
	}
}

func (w *worker) markBotStopped(ctx context.Context, bot watchedBot, status, message string, exitCode *int) {
	w.botLog(ctx, bot.id, "stderr", message)
	_, _ = w.db.Exec(ctx, `
		UPDATE bot_apps SET status=$2,status_message=$3,last_exit_code=COALESCE($4,last_exit_code),
		       container_id='',stopped_at=NOW(),updated_at=NOW()
		WHERE id=$1
	`, bot.id, status, message, exitCode)
	w.clearBotCrashes(bot.id)
}

func (w *worker) recoverTimedOutBotOperations(ctx context.Context) {
	rows, err := w.db.Query(ctx, `
		UPDATE bot_operations SET state='failed',phase='timeout',finished_at=NOW(),error_code='worker_timeout',
		       error_message='คำสั่งค้างนานเกินกำหนด',updated_at=NOW()
		WHERE state='running' AND started_at + make_interval(secs=>timeout_seconds+60) < NOW()
		RETURNING bot_id,kind
	`)
	if err != nil {
		return
	}
	type stuck struct {
		botID int64
		kind  string
	}
	var items []stuck
	for rows.Next() {
		var item stuck
		if rows.Scan(&item.botID, &item.kind) == nil {
			items = append(items, item)
		}
	}
	rows.Close()
	for _, item := range items {
		if item.kind == "bot.delete" {
			continue
		}
		_, _ = w.db.Exec(ctx, `
			UPDATE bot_apps SET status='error',status_message='คำสั่งก่อนหน้าค้างนานเกินไป กดเปิดบอทใหม่อีกครั้ง',updated_at=NOW()
			WHERE id=$1 AND deleted_at IS NULL AND status IN ('starting','building','queued')
		`, item.botID)
	}
}

// botHousekeeping trims old log rows and checks disk use every ten minutes.
func (w *worker) botHousekeeping(ctx context.Context) {
	w.bots.mu.Lock()
	due := time.Since(w.bots.lastTidy) >= botHousekeepEvery
	if due {
		w.bots.lastTidy = time.Now()
	}
	w.bots.mu.Unlock()
	if !due {
		return
	}
	if _, err := w.db.Exec(ctx, `
		DELETE FROM bot_runtime_logs l
		USING (
		  SELECT b.id AS bot_id,
		         (SELECT x.id FROM bot_runtime_logs x WHERE x.bot_id=b.id ORDER BY x.id DESC OFFSET $1 LIMIT 1) AS cutoff
		  FROM bot_apps b
		) c
		WHERE l.bot_id=c.bot_id AND c.cutoff IS NOT NULL AND l.id<=c.cutoff
	`, botLogKeep); err != nil {
		log.Printf("bot log trim failed: %v", err)
	}
	for _, bot := range w.runningBots(ctx) {
		used, err := w.docker.measureBotDisk(ctx, bot.publicID)
		if err != nil {
			continue
		}
		_, _ = w.db.Exec(ctx, `UPDATE bot_apps SET disk_used_mb=$2 WHERE id=$1`, bot.id, used)
		if int64(used) > bot.diskLimitMB {
			name := botContainerName(bot.publicID)
			_ = w.docker.stopContainer(ctx, name, 10)
			w.collectBotLogs(ctx, bot.id, bot.publicID)
			_ = w.docker.removeContainer(ctx, name, true)
			w.markBotStopped(ctx, bot, "error", fmt.Sprintf("ไฟล์ของบอทใช้พื้นที่ %d MB เกินโควตา %d MB ระบบปิดบอทไว้ ลดไฟล์ใน DATA_DIR หรือขอแอดมินเพิ่มพื้นที่", used, bot.diskLimitMB), nil)
		}
	}
}

// measureBotDisk sums the code and data volumes with du in a throwaway container.
func (d *dockerClient) measureBotDisk(ctx context.Context, publicID string) (int, error) {
	name := "nexora-botdu-" + randomHex(6)
	if err := d.pullImage(ctx, "alpine:3.22"); err != nil {
		return 0, err
	}
	body := map[string]any{
		"Image":  "alpine:3.22",
		"User":   "1000:1000",
		"Cmd":    []string{"du", "-sm", "/w", "/d"},
		"Labels": botLabels("bot-disk", publicID),
		"HostConfig": map[string]any{
			"Binds":          []string{botSourceVolume(publicID) + ":/w:ro", botDataVolume(publicID) + ":/d:ro"},
			"NetworkMode":    "none",
			"ReadonlyRootfs": true,
			"CapDrop":        []string{"ALL"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"PidsLimit":      16,
			"Memory":         64 * 1024 * 1024,
			"NanoCpus":       int64(200_000_000),
		},
	}
	if err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(name), body, nil, http.StatusCreated); err != nil {
		return 0, err
	}
	defer d.removeContainer(context.Background(), name, true)
	if err := d.startContainer(ctx, name); err != nil {
		return 0, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if err := d.request(waitCtx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/wait?condition=not-running", nil, nil, http.StatusOK); err != nil {
		return 0, err
	}
	lines, err := d.containerLogLines(ctx, name, time.Time{}, 20)
	if err != nil {
		return 0, err
	}
	return parseDuTotal(lines), nil
}

func parseDuTotal(lines []botLogLine) int {
	total := 0
	for _, line := range lines {
		if line.Stream != "stdout" {
			continue
		}
		fields := strings.Fields(line.Text)
		if len(fields) == 0 {
			continue
		}
		if value, err := strconv.Atoi(fields[0]); err == nil {
			total += value
		}
	}
	return total
}

// ---- Startup -------------------------------------------------------------------------------

func newBotState() *botState {
	return &botState{crashes: map[int64][]time.Time{}, secrets: map[int64][]string{}, lastTidy: time.Now().Add(-botHousekeepEvery + time.Minute)}
}

func (w *worker) startBots(ctx context.Context) {
	if err := w.ensureBotNetwork(ctx); err != nil {
		log.Printf("bot network unavailable: %v", err)
	}
	go w.botLoop(ctx)
	go w.botMonitor(ctx)
}
