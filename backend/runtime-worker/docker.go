package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	errDockerNotFound = errors.New("docker resource not found")
	errDockerConflict = errors.New("docker resource conflict")
)

type dockerClient struct {
	http *http.Client
}

type containerInspect struct {
	ID           string `json:"Id"`
	RestartCount int    `json:"RestartCount"`
	State        struct {
		Status     string `json:"Status"`
		Running    bool   `json:"Running"`
		Restarting bool   `json:"Restarting"`
		ExitCode   int    `json:"ExitCode"`
		Health     struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
}

type runtimeSpec struct {
	Image       string
	User        string
	Command     []string
	Environment []string
	Port        int
	Network     string
	Volume      string
	Health      string
}

func newDockerClient(socket string) *dockerClient {
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
		},
		MaxIdleConns:        32,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     60 * time.Second,
	}
	return &dockerClient{http: &http.Client{Transport: transport}}
}

func (d *dockerClient) ping(ctx context.Context) error {
	return d.request(ctx, http.MethodGet, "/_ping", nil, nil, http.StatusOK)
}

func (d *dockerClient) pullImage(ctx context.Context, image string) error {
	repository, tag := splitImage(image)
	path := "/v1.44/images/create?fromImage=" + url.QueryEscape(repository) + "&tag=" + url.QueryEscape(tag)
	return d.request(ctx, http.MethodPost, path, nil, nil, http.StatusOK)
}

func (d *dockerClient) createNetwork(ctx context.Context, name string, internal bool) error {
	body := map[string]any{
		"Name":           name,
		"CheckDuplicate": true,
		"Driver":         "bridge",
		"Internal":       internal,
		"Attachable":     false,
		"Labels":         runtimeLabels("network"),
	}
	err := d.request(ctx, http.MethodPost, "/v1.44/networks/create", body, nil, http.StatusCreated)
	if errors.Is(err, errDockerConflict) {
		return nil
	}
	return err
}

func (d *dockerClient) removeNetwork(ctx context.Context, name string) error {
	return d.request(ctx, http.MethodDelete, "/v1.44/networks/"+url.PathEscape(name), nil, nil, http.StatusNoContent)
}

func (d *dockerClient) networkExists(ctx context.Context, name string) bool {
	return d.request(ctx, http.MethodGet, "/v1.44/networks/"+url.PathEscape(name), nil, nil, http.StatusOK) == nil
}

func (d *dockerClient) networkHasContainer(ctx context.Context, network, container string) bool {
	var inspect struct {
		Containers map[string]struct {
			Name string `json:"Name"`
		} `json:"Containers"`
	}
	if d.request(ctx, http.MethodGet, "/v1.44/networks/"+url.PathEscape(network), nil, &inspect, http.StatusOK) != nil {
		return false
	}
	for _, attached := range inspect.Containers {
		if attached.Name == container {
			return true
		}
	}
	return false
}

func (d *dockerClient) connectNetwork(ctx context.Context, network, container string) error {
	body := map[string]any{"Container": container}
	err := d.request(ctx, http.MethodPost, "/v1.44/networks/"+url.PathEscape(network)+"/connect", body, nil, http.StatusOK)
	if errors.Is(err, errDockerConflict) {
		return nil
	}
	return err
}

func (d *dockerClient) disconnectNetwork(ctx context.Context, network, container string) error {
	body := map[string]any{"Container": container, "Force": true}
	return d.request(ctx, http.MethodPost, "/v1.44/networks/"+url.PathEscape(network)+"/disconnect", body, nil, http.StatusOK)
}

func (d *dockerClient) createVolume(ctx context.Context, name string) error {
	body := map[string]any{"Name": name, "Driver": "local", "Labels": runtimeLabels("workspace")}
	return d.request(ctx, http.MethodPost, "/v1.44/volumes/create", body, nil, http.StatusCreated)
}

func (d *dockerClient) volumeExists(ctx context.Context, name string) bool {
	return d.request(ctx, http.MethodGet, "/v1.44/volumes/"+url.PathEscape(name), nil, nil, http.StatusOK) == nil
}

func (d *dockerClient) removeVolume(ctx context.Context, name string) error {
	return d.request(ctx, http.MethodDelete, "/v1.44/volumes/"+url.PathEscape(name)+"?force=false", nil, nil, http.StatusNoContent)
}

func (d *dockerClient) populateVolume(ctx context.Context, volume string, archive []byte) error {
	const helperNamePrefix = "nexora-workspace-init-"
	helperName := helperNamePrefix + randomHex(6)
	if err := d.pullImage(ctx, "alpine:3.22"); err != nil {
		return err
	}
	body := map[string]any{
		"Image":      "alpine:3.22",
		"Cmd":        []string{"sh", "-c", "chown -R 1000:1000 /workspace && chmod -R u+rwX,go+rX /workspace"},
		"WorkingDir": "/workspace",
		"Labels":     runtimeLabels("workspace-initializer"),
		"HostConfig": map[string]any{
			"Binds":          []string{volume + ":/workspace:rw"},
			"CapDrop":        []string{"ALL"},
			"CapAdd":         []string{"CHOWN", "FOWNER", "DAC_OVERRIDE"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"NetworkMode":    "none",
			"ReadonlyRootfs": true,
			"PidsLimit":      32,
			"Memory":         64 * 1024 * 1024,
			"NanoCpus":       int64(100_000_000),
			"AutoRemove":     false,
		},
	}
	var response struct {
		ID string `json:"Id"`
	}
	if err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(helperName), body, &response, http.StatusCreated); err != nil {
		return err
	}
	defer d.removeContainer(context.Background(), helperName, true)
	if err := d.requestBytes(ctx, http.MethodPut, "/v1.44/containers/"+url.PathEscape(response.ID)+"/archive?path=%2Fworkspace", archive, "application/x-tar", nil, http.StatusOK); err != nil {
		return err
	}
	if err := d.startContainer(ctx, helperName); err != nil {
		return err
	}
	var wait struct {
		StatusCode int `json:"StatusCode"`
	}
	if err := d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(helperName)+"/wait?condition=not-running", nil, &wait, http.StatusOK); err != nil {
		return err
	}
	if wait.StatusCode != 0 {
		return fmt.Errorf("workspace initializer exited with code %d", wait.StatusCode)
	}
	return nil
}

func (d *dockerClient) createRuntimeContainer(ctx context.Context, name string, spec runtimeSpec, site site) (string, error) {
	memory := site.MemoryMB * 1024 * 1024
	nanoCPU := site.CPUMillicores * 1_000_000
	body := map[string]any{
		"Image":        spec.Image,
		"Hostname":     "site-" + site.PublicID[:12],
		"User":         spec.User,
		"WorkingDir":   "/workspace",
		"Cmd":          spec.Command,
		"Env":          spec.Environment,
		"Labels":       runtimeLabels("website"),
		"ExposedPorts": map[string]any{strconv.Itoa(spec.Port) + "/tcp": map[string]any{}},
		"Healthcheck": map[string]any{
			"Test":        []string{"CMD-SHELL", spec.Health},
			"Interval":    int64(5 * time.Second),
			"Timeout":     int64(3 * time.Second),
			"Retries":     5,
			"StartPeriod": int64(5 * time.Second),
		},
		"HostConfig": map[string]any{
			"Binds":           []string{spec.Volume + ":/workspace:rw"},
			"NetworkMode":     spec.Network,
			"ReadonlyRootfs":  true,
			"CapDrop":         []string{"ALL"},
			"SecurityOpt":     []string{"no-new-privileges:true"},
			"PidsLimit":       site.ProcessLimit,
			"Memory":          memory,
			"MemorySwap":      memory,
			"NanoCpus":        nanoCPU,
			"OomKillDisable":  false,
			"AutoRemove":      false,
			"PublishAllPorts": false,
			"Tmpfs": map[string]string{
				"/tmp": "rw,noexec,nosuid,nodev,size=64m,mode=1777",
			},
			"RestartPolicy": map[string]any{"Name": "unless-stopped", "MaximumRetryCount": 0},
		},
		"NetworkingConfig": map[string]any{
			"EndpointsConfig": map[string]any{spec.Network: map[string]any{}},
		},
	}
	var response struct {
		ID string `json:"Id"`
	}
	err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(name), body, &response, http.StatusCreated)
	return response.ID, err
}

func (d *dockerClient) createCodeServerContainer(ctx context.Context, name, network, volume string) (string, error) {
	memory := int64(512 * 1024 * 1024)
	body := map[string]any{
		"Image":        "nexora-code-server:latest",
		"WorkingDir":   "/home/coder/project",
		"Labels":       runtimeLabels("code-server"),
		"ExposedPorts": map[string]any{"8080/tcp": map[string]any{}},
		"HostConfig": map[string]any{
			"Binds":         []string{volume + ":/home/coder/project:rw"},
			"NetworkMode":   network,
			"SecurityOpt":   []string{"no-new-privileges:true"},
			"Memory":        memory,
			"RestartPolicy": map[string]any{"Name": "unless-stopped"},
		},
		"NetworkingConfig": map[string]any{
			"EndpointsConfig": map[string]any{network: map[string]any{}},
		},
	}
	var response struct {
		ID string `json:"Id"`
	}
	err := d.request(ctx, http.MethodPost, "/v1.44/containers/create?name="+url.QueryEscape(name), body, &response, http.StatusCreated)
	return response.ID, err
}

func (d *dockerClient) runBuildContainer(ctx context.Context, name, image, volume, command string, site site) (string, error) {
	_ = d.removeContainer(context.Background(), name, true)
	memory := site.MemoryMB * 1024 * 1024
	if memory < 256*1024*1024 {
		memory = 256 * 1024 * 1024
	}
	body := map[string]any{
		"Image":      image,
		"User":       "node",
		"WorkingDir": "/workspace",
		"Cmd":        []string{"sh", "-lc", command},
		"Env":        []string{"CI=true", "NODE_ENV=production", "HOME=/tmp"},
		"Labels":     runtimeLabels("builder"),
		"HostConfig": map[string]any{
			"Binds": []string{volume + ":/workspace:rw"},
			// Tenant install and build scripts run here. The default bridge reaches the host and its
			// private network; the bot network is the one the egress firewall already covers.
			"NetworkMode":    botNetworkName,
			"ReadonlyRootfs": true,
			"CapDrop":        []string{"ALL"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"PidsLimit":      site.ProcessLimit,
			"Memory":         memory,
			"MemorySwap":     memory,
			"NanoCpus":       site.CPUMillicores * 1_000_000,
			"AutoRemove":     false,
			"Tmpfs": map[string]string{
				"/tmp": "rw,noexec,nosuid,nodev,size=128m,mode=1777",
			},
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
		Error      *struct {
			Message string `json:"Message"`
		} `json:"Error"`
	}
	if err := d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/wait?condition=not-running", nil, &wait, http.StatusOK); err != nil {
		return "", err
	}
	logs, _ := d.containerLogs(ctx, name, 200)
	if wait.StatusCode != 0 {
		return logs, fmt.Errorf("builder exited with code %d", wait.StatusCode)
	}
	return logs, nil
}

func (d *dockerClient) startContainer(ctx context.Context, name string) error {
	return d.request(ctx, http.MethodPost, "/v1.44/containers/"+url.PathEscape(name)+"/start", nil, nil, http.StatusNoContent, http.StatusNotModified)
}

func (d *dockerClient) removeContainer(ctx context.Context, name string, force bool) error {
	path := "/v1.44/containers/" + url.PathEscape(name) + "?force=" + strconv.FormatBool(force) + "&v=false"
	return d.request(ctx, http.MethodDelete, path, nil, nil, http.StatusNoContent)
}

func (d *dockerClient) inspectContainer(ctx context.Context, name string) (containerInspect, error) {
	var inspect containerInspect
	err := d.request(ctx, http.MethodGet, "/v1.44/containers/"+url.PathEscape(name)+"/json", nil, &inspect, http.StatusOK)
	return inspect, err
}

func (d *dockerClient) containerLogs(ctx context.Context, name string, tail int) (string, error) {
	path := "/v1.44/containers/" + url.PathEscape(name) + "/logs?stdout=1&stderr=1&timestamps=1&tail=" + strconv.Itoa(tail)
	var data []byte
	if err := d.requestRaw(ctx, http.MethodGet, path, nil, "", &data, http.StatusOK); err != nil {
		return "", err
	}
	return decodeDockerLogs(data), nil
}

func (d *dockerClient) request(ctx context.Context, method, path string, body, output any, statuses ...int) error {
	var data io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		data = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, data)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := d.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !containsStatus(statuses, response.StatusCode) {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return dockerResponseError(response.StatusCode, detail)
	}
	if output != nil {
		return json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024)).Decode(output)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return nil
}

func (d *dockerClient) requestBytes(ctx context.Context, method, path string, body []byte, contentType string, output any, statuses ...int) error {
	var response []byte
	err := d.requestRaw(ctx, method, path, body, contentType, &response, statuses...)
	if err != nil || output == nil {
		return err
	}
	return json.Unmarshal(response, output)
}

func (d *dockerClient) requestRaw(ctx context.Context, method, path string, body []byte, contentType string, output *[]byte, statuses ...int) error {
	request, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := d.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !containsStatus(statuses, response.StatusCode) {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return dockerResponseError(response.StatusCode, detail)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err == nil && output != nil {
		*output = data
	}
	return err
}

func runtimeSpecFor(site site, port int, network, volume string) (runtimeSpec, error) {
	projectType := effectiveProjectType(site)
	portStr := strconv.Itoa(port)
	spec := runtimeSpec{
		Port:        port,
		Network:     network,
		Volume:      volume,
		Environment: []string{"PORT=" + portStr, "NODE_ENV=production", "HOME=/tmp"},
		Health:      "wget -q -O - http://127.0.0.1:" + portStr + "/ >/dev/null",
	}
	switch projectType {
	case "static":
		spec.Image = "busybox:1.36.1"
		spec.User = "65534:65534"
		spec.Command = []string{
			"sh",
			"-lc",
			"docroot=/workspace; [ -d /workspace/public_html ] && docroot=/workspace/public_html; [ -d /workspace/public ] && docroot=/workspace/public; exec httpd -f -p " + portStr + " -h \"$docroot\"",
		}
	case "php":
		spec.Image = "serversideup/php:8.3-cli-alpine"
		spec.User = "1000:1000"
		spec.Health = "wget -q -O - http://127.0.0.1:" + portStr + "/__nexora_health >/dev/null"
		spec.Environment = append(spec.Environment, "PHP_CLI_SERVER_WORKERS=8")
		routerScript := `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($uri === '/__nexora_health') {
    header('Content-Type: text/plain; charset=UTF-8');
    http_response_code(200);
    echo 'ok';
    exit;
}

$docroot = '/workspace';
if (is_dir('/workspace/public_html')) { $docroot = '/workspace/public_html'; }
else if (is_dir('/workspace/public')) { $docroot = '/workspace/public'; }
else if (is_dir('/workspace/frontend/build')) { $docroot = '/workspace/frontend/build'; }
else if (is_dir('/workspace/frontend/dist')) { $docroot = '/workspace/frontend/dist'; }

$file = $docroot . $uri;
if ($uri !== '/' && file_exists($file) && !is_dir($file)) {
    return false;
}

$ext = pathinfo($uri, PATHINFO_EXTENSION);
$staticExts = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'map', 'json', 'webp', 'mp4', 'mp3', 'wav'];
if (in_array(strtolower($ext), $staticExts)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo '404 Not Found';
    exit;
}

$isApi = str_starts_with($uri, '/api') || str_starts_with($uri, '/auth') || $_SERVER['REQUEST_METHOD'] !== 'GET';

if ($isApi) {
    $backendScript = null;
    if (file_exists('/workspace/backend/index.php')) {
        $backendScript = '/workspace/backend/index.php';
    } else if (file_exists('/workspace/backend/router.php')) {
        $backendScript = '/workspace/backend/router.php';
    } else if (file_exists($docroot . '/index.php')) {
        $backendScript = $docroot . '/index.php';
    } else if (file_exists('/workspace/index.php')) {
        $backendScript = '/workspace/index.php';
    }

    if ($backendScript) {
        $_SERVER['SCRIPT_FILENAME'] = $backendScript;
        chdir(dirname($backendScript));
        require $backendScript;
        exit;
    }
}

if (file_exists($docroot . '/index.html')) {
    header('Content-Type: text/html; charset=UTF-8');
    readfile($docroot . '/index.html');
    exit;
}
if (file_exists($docroot . '/hotspot-admin.html')) {
    header('Content-Type: text/html; charset=UTF-8');
    readfile($docroot . '/hotspot-admin.html');
    exit;
}

if (file_exists('/workspace/backend/index.php')) {
    $backendScript = '/workspace/backend/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $backendScript;
    chdir(dirname($backendScript));
    require $backendScript;
    exit;
} else if (file_exists($docroot . '/index.php')) {
    $backendScript = $docroot . '/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $backendScript;
    chdir(dirname($backendScript));
    require $backendScript;
    exit;
} else if (file_exists('/workspace/index.php')) {
    $backendScript = '/workspace/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $backendScript;
    chdir(dirname($backendScript));
    require $backendScript;
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
http_response_code(404);
echo '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>NEXORA CLOUD</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:clamp(16px,4vw,32px);background-color:#07080c;background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(94,94,230,0.15),transparent 70%),radial-gradient(ellipse 60% 40% at 50% 110%,rgba(255,16,24,0.08),transparent 70%);color:#f8fafc;font-family:\'Kanit\',\'Inter\',sans-serif}.card{width:min(480px,100%);padding:32px 28px;background:rgba(18,20,30,0.94);border:1px solid rgba(255,255,255,0.09);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,0.65);backdrop-filter:blur(24px);text-align:center;display:flex;flex-direction:column;align-items:center}.badge{display:inline-flex;align-items:center;gap:8px;color:#fff;font-size:13.5px;font-weight:700;margin-bottom:20px;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)}.badge svg{width:16px;height:16px;color:#5e5ee6}h1{font-size:20px;font-weight:600;color:#fff;margin-bottom:10px}p{font-size:13.5px;font-weight:300;color:#94a3b8;line-height:1.65;max-width:400px}.footer{margin-top:22px;font-size:11.5px;color:#64748b}</style></head><body><main class="card"><div class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg><span>NEXORA CLOUD</span></div><h1>ยังไม่มีข้อมูลบนเว็บไซต์นี้</h1><p>ยังไม่มีไฟล์สำหรับแสดงผล กรุณาอัปโหลดไฟล์เพื่อเริ่มต้นใช้งาน</p><div class="footer">NEXORA Cloud Hosting · Protected Runtime</div></main></body></html>';
exit;
`
		spec.Command = []string{
			"sh",
			"-lc",
			"cat << 'EOF' > /tmp/router.php\n" + routerScript + "\nEOF\nexport PHP_CLI_SERVER_WORKERS=8\nexec php -S 0.0.0.0:" + portStr + " -t /workspace /tmp/router.php",
		}
	case "node":
		spec.Image = "node:22-alpine"
		spec.User = "node"
		command := strings.TrimSpace(site.StartCommand)
		if command == "" {
			switch site.PackageManager {
			case "pnpm":
				command = "pnpm start"
			case "yarn":
				command = "yarn start"
			default:
				command = "npm start"
			}
		}
		spec.Command = []string{"sh", "-lc", command}
	default:
		return runtimeSpec{}, fmt.Errorf("unsupported project type %q", projectType)
	}
	return spec, nil
}

func splitImage(image string) (string, string) {
	lastSlash := strings.LastIndex(image, "/")
	lastColon := strings.LastIndex(image, ":")
	if lastColon > lastSlash {
		return image[:lastColon], image[lastColon+1:]
	}
	return image, "latest"
}

func runtimeLabels(kind string) map[string]string {
	return map[string]string{
		"com.nexora.managed": "true",
		"com.nexora.kind":    kind,
	}
}

func containsStatus(statuses []int, value int) bool {
	for _, status := range statuses {
		if status == value {
			return true
		}
	}
	return false
}

func dockerStatusError(status int) error {
	switch status {
	case http.StatusNotFound:
		return errDockerNotFound
	case http.StatusConflict, http.StatusNotModified:
		return errDockerConflict
	default:
		return fmt.Errorf("Docker API returned HTTP %d", status)
	}
}

func dockerResponseError(status int, body []byte) error {
	base := dockerStatusError(status)
	var payload struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &payload) == nil && strings.TrimSpace(payload.Message) != "" {
		return fmt.Errorf("%w: %s", base, safeLogMessage(payload.Message))
	}
	return base
}

func decodeDockerLogs(data []byte) string {
	if len(data) < 8 || (data[0] != 1 && data[0] != 2) {
		return strings.TrimSpace(string(data))
	}
	var result strings.Builder
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
		result.Write(payload)
	}
	return strings.TrimSpace(result.String())
}
