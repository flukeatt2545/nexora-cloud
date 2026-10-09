<?php
declare(strict_types=1);

session_set_cookie_params([
    "lifetime" => 0,
    "path" => "/",
    "secure" => (($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? "http") === "https"),
    "httponly" => true,
    "samesite" => "Lax",
]);
session_name("SignonSession");
session_start();

$returnUrl = getenv("PMA_RETURN_URL") ?: ($_SERVER["HTTP_REFERER"] ?? "/");
$internalSecret = getenv("PMA_INTERNAL_SECRET") ?: "";
$apiUrl = rtrim(getenv("PMA_INTERNAL_API_URL") ?: "http://api:8080", "/");
$dbHost = getenv("PMA_HOST") ?: "tenant-db";
$dbPort = (int)(getenv("PMA_PORT") ?: 3306);
$loginError = "";
$activeTab = "db";
$directDbLoginEnabled = getenv("PMA_ALLOW_DIRECT_DB_LOGIN") === "1";
$blockedDbAccounts = ["root", "pma", "mysql.sys", "mysql.session", "mysql.infoschema", "debian-sys-maint"];
$_SESSION["portal_csrf"] ??= bin2hex(random_bytes(24));
$databaseChoices = [];

function portalApiRequest(string $path, string $method = "GET", ?array $body = null, string $sessionCookie = ""): array
{
    global $apiUrl;
    $headers = ["Accept: application/json", "User-Agent: " . str_replace(["\r", "\n"], "", (string)($_SERVER["HTTP_USER_AGENT"] ?? ""))];
    if ($body !== null) {
        $headers[] = "Content-Type: application/json";
    }
    if ($method !== "GET") {
        $headers[] = "Origin: https://nkn02.com";
    }
    if ($sessionCookie !== "") {
        $headers[] = "Cookie: nexora_session=" . $sessionCookie;
    }
    $clientIp = collectClientIps()[0] ?? "";
    if (filter_var($clientIp, FILTER_VALIDATE_IP)) {
        $headers[] = "X-Real-IP: " . $clientIp;
    }
    $issuedCookie = "";
    $request = curl_init($apiUrl . $path);
    curl_setopt_array($request, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => static function ($handle, string $header) use (&$issuedCookie): int {
            if (preg_match('/^Set-Cookie:\s*nexora_session=([A-Za-z0-9_-]+)/i', $header, $match)) {
                $issuedCookie = $match[1];
            }
            return strlen($header);
        },
    ]);
    if ($body !== null) {
        curl_setopt($request, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
    }
    $response = curl_exec($request);
    $status = (int)curl_getinfo($request, CURLINFO_RESPONSE_CODE);
    curl_close($request);
    $data = is_string($response) ? json_decode($response, true) : null;
    return [$status, is_array($data) ? $data : [], $issuedCookie];
}

function portalClearNexoraSession(): void
{
    $cookie = (string)($_SESSION["portal_nexora_cookie"] ?? "");
    if ($cookie !== "") {
        portalApiRequest("/api/auth/logout", "POST", [], $cookie);
    }
    unset($_SESSION["portal_nexora_cookie"], $_SESSION["portal_database_choices"], $_SESSION["portal_nexora_expires"], $_SESSION["portal_nexora_fingerprint"]);
}

function portalFingerprint(): string
{
    return hash("sha256", (collectClientIps()[0] ?? "") . "\n" . (string)($_SERVER["HTTP_USER_AGENT"] ?? ""));
}

function portalOpenDatabase(string $choice): string
{
    $cookie = (string)($_SESSION["portal_nexora_cookie"] ?? "");
    $choices = (array)($_SESSION["portal_database_choices"] ?? []);
    if ($cookie === "" || time() > (int)($_SESSION["portal_nexora_expires"] ?? 0) ||
        !hash_equals((string)($_SESSION["portal_nexora_fingerprint"] ?? ""), portalFingerprint()) ||
        !isset($choices[$choice])) {
        portalClearNexoraSession();
        return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    }
    $siteId = (string)$choices[$choice]["siteId"];
    $databaseId = (string)$choices[$choice]["databaseId"];
    [$status, $data] = portalApiRequest(
        "/api/hosting/sites/" . rawurlencode($siteId) . "/database/phpmyadmin",
        "POST", ["databaseId" => $databaseId], $cookie
    );
    if ($status === 200 && preg_match('/^[a-f0-9]{64}$/', (string)($data["ticket"] ?? ""))) {
        header("Cache-Control: no-store, private");
        header("Location: /login?ticket=" . rawurlencode($data["ticket"]), true, 303);
        exit;
    }
    if ($status === 401 || $status === 403) {
        portalClearNexoraSession();
    }
    return (string)($data["error"] ?? "เปิดฐานข้อมูลไม่ได้ กรุณาลองใหม่อีกครั้ง");
}

function dbLoginThrottleAllowed(): bool
{
    $now = time();
    $attempts = array_values(array_filter(
        (array)($_SESSION["db_login_attempts"] ?? []),
        fn ($t) => ($now - (int)$t) < 600
    ));
    $_SESSION["db_login_attempts"] = $attempts;
    return count($attempts) < 5;
}

function dbLoginThrottleRecord(): void
{
    $now = time();
    $attempts = array_values(array_filter(
        (array)($_SESSION["db_login_attempts"] ?? []),
        fn ($t) => ($now - (int)$t) < 600
    ));
    $attempts[] = $now;
    $_SESSION["db_login_attempts"] = $attempts;
    sleep(1);
}

function collectClientIps(): array
{
    $ips = [];
    foreach (["HTTP_CF_CONNECTING_IP", "HTTP_TRUE_CLIENT_IP", "HTTP_X_REAL_IP"] as $header) {
        $value = trim((string)($_SERVER[$header] ?? ""));
        if ($value !== "") {
            $ips[] = $value;
        }
    }
    foreach (explode(",", (string)($_SERVER["HTTP_X_FORWARDED_FOR"] ?? "")) as $part) {
        $value = trim($part);
        if ($value !== "") {
            $ips[] = $value;
        }
    }
    $remote = trim((string)($_SERVER["REMOTE_ADDR"] ?? ""));
    if ($remote !== "") {
        $ips[] = $remote;
    }
    return array_values(array_unique($ips));
}

function renderSignonWarning(string $title, string $message, string $returnUrl, int $status): never
{
    http_response_code($status);
    header("Cache-Control: no-store, private");
    header("Content-Type: text/html; charset=utf-8");
    $safeTitle = htmlspecialchars($title, ENT_QUOTES, "UTF-8");
    $safeMessage = htmlspecialchars($message, ENT_QUOTES, "UTF-8");
    $safeReturnUrl = htmlspecialchars($returnUrl, ENT_QUOTES, "UTF-8");
    $brandHost = htmlspecialchars($_SERVER["HTTP_HOST"] ?? "db.nkn02.com", ENT_QUOTES, "UTF-8");
    echo '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . $safeTitle . ' — ' . $brandHost . '</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/signon.css"></head>';
    echo '<body><div class="grid-bg"></div><main class="warning-shell"><section class="warning-card"><header>';
    echo '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>';
    echo '<div><strong>' . $brandHost . '</strong><small>DATABASE PORTAL</small></div></header>';
    echo '<div class="warning-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>';
    echo '<p class="warning-label">การเชื่อมต่อถูกหยุด</p><h1>' . $safeTitle . '</h1><p class="warning-copy">' . $safeMessage . '</p>';
    echo '<a class="warning-action" href="' . $safeReturnUrl . '">กลับไปหน้าหลัก</a></section></main></body></html>';
    exit;
}

// 1. Check for Ticket (POST or GET)
$ticket = $_POST["ticket"] ?? ($_GET["ticket"] ?? "");
if (is_string($ticket) && preg_match("/^[a-f0-9]{64}$/", $ticket)) {
    $clientIps = collectClientIps();
    $clientIp = $clientIps[0] ?? "";
    $userAgent = $_SERVER["HTTP_USER_AGENT"] ?? "";

    $payload = json_encode([
        "ticket" => $ticket,
        "clientIp" => $clientIp,
        "clientIps" => $clientIps,
        "userAgent" => $userAgent,
    ], JSON_UNESCAPED_SLASHES);

    $request = curl_init($apiUrl . "/api/internal/phpmyadmin/tickets/consume");
    curl_setopt_array($request, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "X-PMA-Internal-Secret: " . $internalSecret,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 8,
    ]);
    $response = curl_exec($request);
    $statusCode = (int)curl_getinfo($request, CURLINFO_RESPONSE_CODE);
    curl_close($request);

    if (is_string($response) && $statusCode === 200) {
        $data = json_decode($response, true);
        if (is_array($data) && ($data["engine"] ?? "") === "mysql") {
            $_SESSION["PMA_single_signon_user"] = (string)$data["username"];
            $_SESSION["PMA_single_signon_password"] = (string)$data["password"];
            $_SESSION["PMA_single_signon_host"] = (string)$data["host"];
            $_SESSION["PMA_single_signon_port"] = (int)$data["port"];
            $_SESSION["PMA_single_signon_cfgupdate"] = [
                "AllowUserDropDatabase" => false,
                "ShowChgPassword" => false,
                "only_db" => (string)$data["database"],
            ];
            portalClearNexoraSession();
            session_write_close();
            header("Cache-Control: no-store, private");
            header("Location: index.php", true, 302);
            exit;
        }
    }

    $errData = is_string($response) ? json_decode($response, true) : null;
    $errCode = is_array($errData) ? ($errData["code"] ?? "") : "";
    $errMsg = is_array($errData) ? ($errData["error"] ?? "") : "";

    if ($statusCode === 503 || $errCode === "database_connection_failed") {
        renderSignonWarning("ไม่สามารถเชื่อมต่อฐานข้อมูลได้", $errMsg ?: "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง", $returnUrl, 503);
    }
    if ($errCode === "database_suspended" || $errCode === "database_deleted") {
        renderSignonWarning($errCode === "database_suspended" ? "ฐานข้อมูลถูกระงับ" : "ฐานข้อมูลถูกลบแล้ว", $errMsg ?: "ฐานข้อมูลนี้เปิดใช้งานไม่ได้", $returnUrl, 423);
    }
    if ($errCode === "ticket_binding_mismatch") {
        renderSignonWarning("อุปกรณ์ไม่ตรงกับตั๋วที่ออกให้", "โทเค็นนี้ผูกกับอุปกรณ์หรือเบราว์เซอร์อื่น กรุณากดเปิดใหม่อีกครั้งจากอุปกรณ์ของคุณ", $returnUrl, 403);
    }
    renderSignonWarning("โทเค็นเข้าถึงฐานข้อมูลหมดอายุ", "โทเค็นผ่านทางชั่วคราวหมดอายุหรือถูกใช้งานไปแล้ว กรุณากลับไปกดเปิดใหม่อีกครั้ง", $returnUrl, 403);
}

// 2. Check for Direct Database Login Form Submission
if (($_SERVER["REQUEST_METHOD"] ?? "") === "POST") {
    $action = $_POST["action"] ?? "";

    if ($action === "db_login") {
        $activeTab = "db";
        if (!$directDbLoginEnabled) {
            $loginError = "การเข้าสู่ระบบด้วยบัญชีฐานข้อมูลโดยตรงถูกปิดใช้งาน กรุณาเข้าใช้งานผ่านตั๋วจากระบบ NEXORA หรือบัญชี Nexora Cloud";
        } else {
            $dbUser = trim((string)($_POST["db_user"] ?? ""));
            $dbPass = (string)($_POST["db_pass"] ?? "");

            if ($dbUser === "" || $dbPass === "") {
                $loginError = "กรุณากรอกชื่อผู้ใช้และรหัสผ่านฐานข้อมูลให้ครบถ้วน";
            } elseif (in_array(strtolower($dbUser), $blockedDbAccounts, true)) {
                dbLoginThrottleRecord();
                $loginError = "ระบบไม่อนุญาตให้เข้าสู่ระบบด้วยบัญชีผู้ดูแลฐานข้อมูลผ่านหน้านี้";
            } elseif (!dbLoginThrottleAllowed()) {
                $loginError = "พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง";
            } else {
                dbLoginThrottleRecord();
                // Attempt MySQL connection
                mysqli_report(MYSQLI_REPORT_OFF);
                try {
                    $mysqli = mysqli_init();
                    $caPath = "/etc/phpmyadmin/mysql-ca.pem";
                    if (file_exists($caPath)) {
                        mysqli_ssl_set($mysqli, NULL, NULL, $caPath, NULL, NULL);
                    }
                    $connected = @mysqli_real_connect($mysqli, $dbHost, $dbUser, $dbPass, "", $dbPort, NULL, file_exists($caPath) ? MYSQLI_CLIENT_SSL : 0);

                    if (!$connected) {
                        $loginError = "ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง";
                    } else {
                        // Find databases accessible to this user
                        $res = mysqli_query($mysqli, "SHOW DATABASES");
                        $allowedDbs = [];
                        if ($res) {
                            while ($row = mysqli_fetch_row($res)) {
                                $d = $row[0];
                                if (!in_array($d, ['information_schema', 'performance_schema', 'mysql', 'sys', 'phpmyadmin'], true)) {
                                    $allowedDbs[] = $d;
                                }
                            }
                            mysqli_free_result($res);
                        }
                        mysqli_close($mysqli);

                        if (empty($allowedDbs)) {
                            $loginError = "เชื่อมต่อสำเร็จ แต่ไม่พบฐานข้อมูลที่บัญชีนี้ได้รับสิทธิ์เข้าถึง";
                        } else {
                            $_SESSION["db_login_attempts"] = [];
                            $_SESSION["PMA_single_signon_user"] = $dbUser;
                            $_SESSION["PMA_single_signon_password"] = $dbPass;
                            $_SESSION["PMA_single_signon_host"] = $dbHost;
                            $_SESSION["PMA_single_signon_port"] = $dbPort;
                            $_SESSION["PMA_single_signon_cfgupdate"] = [
                                "AllowUserDropDatabase" => false,
                                "ShowChgPassword" => false,
                            ];
                            if (!empty($allowedDbs)) {
                                $_SESSION["PMA_single_signon_cfgupdate"]["only_db"] = count($allowedDbs) === 1 ? $allowedDbs[0] : $allowedDbs;
                            }
                            session_write_close();
                            header("Cache-Control: no-store, private");
                            header("Location: index.php", true, 302);
                            exit;
                        }
                    }
                } catch (Throwable $e) {
                    $loginError = "ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง";
                }
            }
        }
    } else if (in_array($action, ["nexora_login", "nexora_select_database", "nexora_reset"], true)) {
        $activeTab = "nexora";
        if (!hash_equals((string)($_SESSION["portal_csrf"] ?? ""), (string)($_POST["portal_csrf"] ?? ""))) {
            $loginError = "คำขอหมดอายุ กรุณารีเฟรชหน้าแล้วลองใหม่";
        } elseif ($action === "nexora_reset") {
            portalClearNexoraSession();
        } elseif ($action === "nexora_select_database") {
            $loginError = portalOpenDatabase((string)($_POST["database_choice"] ?? ""));
        } else {
            portalClearNexoraSession();
            $nexoraUser = trim((string)($_POST["nexora_user"] ?? ""));
            $nexoraPass = (string)($_POST["nexora_pass"] ?? "");
            if ($nexoraUser === "" || $nexoraPass === "") {
                $loginError = "กรุณากรอกชื่อผู้ใช้และรหัสผ่านบัญชี NEXORA";
            } else {
                [$authStatus, $authData, $sessionCookie] = portalApiRequest(
                    "/api/auth/login", "POST", ["username" => $nexoraUser, "password" => $nexoraPass]
                );
                unset($nexoraPass);
                if ($authStatus !== 200 || $sessionCookie === "") {
                    $loginError = in_array($authStatus, [400, 401, 403, 429], true)
                        ? (string)($authData["error"] ?? "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบบัญชีอีกครั้ง")
                        : "เชื่อมต่อ NEXORA ไม่ได้ กรุณาลองใหม่อีกครั้ง";
                } else {
                    $_SESSION["portal_nexora_cookie"] = $sessionCookie;
                    $_SESSION["portal_nexora_expires"] = time() + 300;
                    $_SESSION["portal_nexora_fingerprint"] = portalFingerprint();
                    $choices = [];
                    $cursor = "";
                    $loadFailed = false;
                    for ($page = 0; $page < 10; $page++) {
                        $query = "/api/hosting/sites?limit=100" . ($cursor !== "" ? "&cursor=" . rawurlencode($cursor) : "");
                        [$sitesStatus, $sitesData] = portalApiRequest($query, "GET", null, $sessionCookie);
                        if ($sitesStatus !== 200 || !isset($sitesData["items"]) || !is_array($sitesData["items"])) {
                            $loadFailed = true;
                            break;
                        }
                        foreach ($sitesData["items"] as $site) {
                            $siteId = (string)($site["id"] ?? "");
                            if ($siteId === "" || ($site["accessRole"] ?? "") === "viewer") {
                                continue;
                            }
                            [$dbStatus, $dbData] = portalApiRequest(
                                "/api/hosting/sites/" . rawurlencode($siteId) . "/database", "GET", null, $sessionCookie
                            );
                            if ($dbStatus === 403) {
                                continue;
                            }
                            if ($dbStatus !== 200 || !isset($dbData["databases"]) || !is_array($dbData["databases"])) {
                                $loadFailed = true;
                                break 2;
                            }
                            foreach ($dbData["databases"] as $database) {
                                if (($database["engine"] ?? "") !== "mysql" || empty($database["id"])) {
                                    continue;
                                }
                                $choiceId = (string)count($choices);
                                $choices[$choiceId] = [
                                    "siteId" => $siteId,
                                    "databaseId" => (string)$database["id"],
                                    "siteName" => (string)($site["name"] ?? $siteId),
                                    "databaseName" => (string)($database["dbName"] ?? $database["id"]),
                                    "label" => (string)($site["name"] ?? $siteId) . " — " . (string)($database["dbName"] ?? $database["id"]),
                                ];
                            }
                        }
                        $cursor = (string)($sitesData["nextCursor"] ?? "");
                        if ($cursor === "" || $cursor === "0") {
                            break;
                        }
                        if ($page === 9) {
                            $loadFailed = true;
                        }
                    }
                    if ($loadFailed || $choices === []) {
                        portalClearNexoraSession();
                        $loginError = $loadFailed
                            ? "โหลดรายการฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
                            : "บัญชีนี้ยังไม่มีฐานข้อมูล MySQL ที่เปิดผ่าน phpMyAdmin ได้";
                    } else {
                        $_SESSION["portal_database_choices"] = $choices;
                        $databaseChoices = $choices;
                        if (count($choices) === 1) {
                            $loginError = portalOpenDatabase((string)array_key_first($choices));
                        }
                    }
                }
            }
        }
    }
}
$databaseChoices = (array)($_SESSION["portal_database_choices"] ?? []);
if ($databaseChoices !== [] && (time() > (int)($_SESSION["portal_nexora_expires"] ?? 0) ||
    !hash_equals((string)($_SESSION["portal_nexora_fingerprint"] ?? ""), portalFingerprint()))) {
    portalClearNexoraSession();
    $databaseChoices = [];
}
$portalBrand = htmlspecialchars($_SERVER["HTTP_HOST"] ?? "db.nkn02.com", ENT_QUOTES, "UTF-8");
if (!$directDbLoginEnabled) {
    $activeTab = "nexora";
}
?>
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $portalBrand ?> — Database Portal</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/signon.css">
</head>
<body>
    <div class="grid-bg"></div>
    <div class="portal-shell">
        <div class="portal-container">
            <header class="portal-header">
                <div class="portal-brand">
                    <span class="brand-dot"></span>
                    <span class="brand-name"><?= $portalBrand ?></span>
                </div>
                <h1 class="portal-title"><?= $databaseChoices !== [] ? 'เลือกฐานข้อมูล' : 'Database Portal' ?></h1>
                <p class="portal-subtitle"><?= $databaseChoices !== [] ? 'เลือกฐานข้อมูล MySQL ที่ต้องการเปิดใน phpMyAdmin' : 'เข้าสู่ระบบเพื่อจัดการฐานข้อมูล MySQL ของคุณ' ?></p>
            </header>

            <main class="portal-card">
                <?php if (!empty($loginError)): ?>
                    <div class="alert-error">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <div><?= htmlspecialchars($loginError, ENT_QUOTES, "UTF-8") ?></div>
                    </div>
                <?php endif; ?>

                <?php if ($directDbLoginEnabled): ?>
                <div class="portal-tabs">
                    <button type="button" class="portal-tab <?= $activeTab === 'db' ? 'active' : '' ?>" onclick="switchTab('db')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                        </svg>
                        บัญชีฐานข้อมูล
                    </button>
                    <button type="button" class="portal-tab <?= $activeTab === 'nexora' ? 'active' : '' ?>" onclick="switchTab('nexora')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        บัญชี Nexora Cloud
                    </button>
                </div>
                <?php endif; ?>

                <!-- Tab 1: Database Account (only when direct DB login is enabled) -->
                <?php if ($directDbLoginEnabled): ?>
                <form method="POST" action="/login" id="form-db" style="<?= $activeTab === 'db' ? '' : 'display:none;' ?>">
                    <input type="hidden" name="action" value="db_login">

                    <div class="form-group">
                        <label class="form-label" for="db_user">Database Username</label>
                        <div class="input-wrapper">
                            <span class="input-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                            </span>
                            <input type="text" id="db_user" name="db_user" class="form-input" placeholder="nxu_xxxxxx" required autocomplete="username" value="<?= htmlspecialchars($_POST['db_user'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="db_pass">Database Password</label>
                        <div class="input-wrapper">
                            <span class="input-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                            </span>
                            <input type="password" id="db_pass" name="db_pass" class="form-input" placeholder="รหัสผ่านฐานข้อมูล" required autocomplete="current-password">
                            <button type="button" class="toggle-password" onclick="togglePass('db_pass', this)" aria-label="แสดงรหัสผ่าน">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="btn-submit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                            <polyline points="10 17 15 12 10 7"></polyline>
                            <line x1="15" y1="12" x2="3" y2="12"></line>
                        </svg>
                        เข้าสู่ phpMyAdmin
                    </button>
                </form>
                <?php endif; ?>

                <!-- Tab 2: Nexora Cloud Account -->
                <form method="POST" action="/login" id="form-nexora" style="<?= $activeTab === 'nexora' && $databaseChoices === [] ? '' : 'display:none;' ?>">
                    <input type="hidden" name="action" value="nexora_login">
                    <input type="hidden" name="portal_csrf" value="<?= htmlspecialchars((string)$_SESSION['portal_csrf'], ENT_QUOTES, 'UTF-8') ?>">

                    <div class="form-group">
                        <label class="form-label" for="nexora_user">ชื่อผู้ใช้ NEXORA</label>
                        <div class="input-wrapper">
                            <span class="input-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                    <polyline points="22,6 12,13 2,6"></polyline>
                                </svg>
                            </span>
                            <input type="text" id="nexora_user" name="nexora_user" class="form-input" placeholder="ชื่อผู้ใช้ NEXORA" required autocomplete="username" value="<?= htmlspecialchars($_POST['nexora_user'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="nexora_pass">รหัสผ่านบัญชี</label>
                        <div class="input-wrapper">
                            <span class="input-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                            </span>
                            <input type="password" id="nexora_pass" name="nexora_pass" class="form-input" placeholder="รหัสผ่านบัญชี Nexora" required autocomplete="current-password">
                            <button type="button" class="toggle-password" onclick="togglePass('nexora_pass', this)" aria-label="แสดงรหัสผ่าน">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="btn-submit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                            <polyline points="10 17 15 12 10 7"></polyline>
                            <line x1="15" y1="12" x2="3" y2="12"></line>
                        </svg>
                        เข้าสู่ phpMyAdmin
                    </button>
                </form>

                <?php if ($databaseChoices !== []): ?>
                <form method="POST" action="/login" id="form-database-choice" style="<?= $activeTab === 'nexora' ? '' : 'display:none;' ?>">
                    <input type="hidden" name="action" value="nexora_select_database">
                    <input type="hidden" name="portal_csrf" value="<?= htmlspecialchars((string)$_SESSION['portal_csrf'], ENT_QUOTES, 'UTF-8') ?>">
                    <div class="choice-summary"><span>ฐานข้อมูลที่เปิดได้</span><strong><?= count($databaseChoices) ?> รายการ</strong></div>
                    <div class="form-group">
                        <label class="form-label" for="database_choice">ฐานข้อมูล</label>
                        <select id="database_choice" name="database_choice" class="form-input database-native-select" required>
                            <?php foreach ($databaseChoices as $choiceId => $choice): ?>
                                <option value="<?= htmlspecialchars((string)$choiceId, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars((string)$choice['label'], ENT_QUOTES, 'UTF-8') ?></option>
                            <?php endforeach; ?>
                        </select>
                        <div class="database-picker" id="database-picker" hidden>
                            <button type="button" class="database-picker-trigger" id="database-picker-trigger" aria-expanded="false" aria-controls="database-picker-panel" aria-label="เลือกฐานข้อมูล">
                                <span class="database-picker-selection">
                                    <span class="database-picker-site" id="database-picker-site"><?= htmlspecialchars((string)reset($databaseChoices)['siteName'], ENT_QUOTES, 'UTF-8') ?></span>
                                    <span class="database-picker-name" id="database-picker-name"><?= htmlspecialchars((string)reset($databaseChoices)['databaseName'], ENT_QUOTES, 'UTF-8') ?></span>
                                </span>
                                <svg class="database-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                            </button>
                            <div class="database-picker-panel" id="database-picker-panel" hidden>
                                <div class="database-picker-search-wrap">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                                    <input type="search" class="database-picker-search" id="database-picker-search" placeholder="ค้นหาชื่อเว็บหรือฐานข้อมูล" aria-label="ค้นหาฐานข้อมูล" autocomplete="off">
                                </div>
                                <div class="database-picker-list" id="database-picker-list" role="listbox" aria-label="ฐานข้อมูลที่เปิดได้">
                                    <?php foreach ($databaseChoices as $choiceId => $choice): ?>
                                        <button type="button" class="database-picker-option" role="option" data-value="<?= htmlspecialchars((string)$choiceId, ENT_QUOTES, 'UTF-8') ?>" data-search="<?= htmlspecialchars((string)$choice['label'], ENT_QUOTES, 'UTF-8') ?>" aria-selected="<?= (string)$choiceId === (string)array_key_first($databaseChoices) ? 'true' : 'false' ?>">
                                            <span class="database-picker-option-main"><?= htmlspecialchars((string)$choice['siteName'], ENT_QUOTES, 'UTF-8') ?></span>
                                            <span class="database-picker-option-sub"><?= htmlspecialchars((string)$choice['databaseName'], ENT_QUOTES, 'UTF-8') ?></span>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                                        </button>
                                    <?php endforeach; ?>
                                </div>
                                <p class="database-picker-empty" id="database-picker-empty" hidden>ไม่พบฐานข้อมูลที่ค้นหา</p>
                            </div>
                        </div>
                    </div>
                    <button type="submit" class="btn-submit">เปิด phpMyAdmin</button>
                </form>
                <form method="POST" action="/login" class="database-reset-form" style="<?= $activeTab === 'nexora' ? '' : 'display:none;' ?>">
                    <input type="hidden" name="action" value="nexora_reset">
                    <input type="hidden" name="portal_csrf" value="<?= htmlspecialchars((string)$_SESSION['portal_csrf'], ENT_QUOTES, 'UTF-8') ?>">
                    <button type="submit" class="database-reset">ใช้บัญชีอื่น</button>
                </form>
                <?php endif; ?>

                <div class="portal-info">
                    <span>ระบบแยกสิทธิ์เฉพาะฐานข้อมูลของคุณ</span>
                    <a href="https://nkn02.com" target="_blank" rel="noreferrer">NEXORA CLOUD</a>
                </div>
            </main>
        </div>
    </div>

    <script>
        (() => {
            const picker = document.getElementById('database-picker');
            const native = document.getElementById('database_choice');
            if (!picker || !native) return;
            const trigger = document.getElementById('database-picker-trigger');
            const panel = document.getElementById('database-picker-panel');
            const search = document.getElementById('database-picker-search');
            const empty = document.getElementById('database-picker-empty');
            const options = Array.from(picker.querySelectorAll('.database-picker-option'));
            const visibleOptions = () => options.filter(option => !option.hidden);
            const close = () => {
                panel.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');
            };
            const open = () => {
                panel.hidden = false;
                trigger.setAttribute('aria-expanded', 'true');
                search.value = '';
                options.forEach(option => { option.hidden = false; });
                empty.hidden = true;
                search.focus();
            };
            const choose = option => {
                native.value = option.dataset.value;
                document.getElementById('database-picker-site').textContent = option.querySelector('.database-picker-option-main').textContent;
                document.getElementById('database-picker-name').textContent = option.querySelector('.database-picker-option-sub').textContent;
                options.forEach(item => item.setAttribute('aria-selected', item === option ? 'true' : 'false'));
                close();
                trigger.focus();
            };
            trigger.addEventListener('click', () => panel.hidden ? open() : close());
            trigger.addEventListener('keydown', event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
            });
            search.addEventListener('input', () => {
                const query = search.value.trim().toLocaleLowerCase();
                options.forEach(option => { option.hidden = !option.dataset.search.toLocaleLowerCase().includes(query); });
                empty.hidden = visibleOptions().length !== 0;
            });
            search.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
                if (event.key === 'ArrowDown' && visibleOptions().length) { event.preventDefault(); visibleOptions()[0].focus(); }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (visibleOptions().length) choose(visibleOptions()[0]);
                }
            });
            options.forEach(option => {
                option.addEventListener('click', () => choose(option));
                option.addEventListener('keydown', event => {
                    const visible = visibleOptions();
                    const index = visible.indexOf(option);
                    if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
                    if (event.key === 'ArrowDown' && index < visible.length - 1) { event.preventDefault(); visible[index + 1].focus(); }
                    if (event.key === 'ArrowUp') { event.preventDefault(); index > 0 ? visible[index - 1].focus() : search.focus(); }
                });
            });
            document.addEventListener('pointerdown', event => { if (!picker.contains(event.target)) close(); });
            picker.hidden = false;
            document.documentElement.classList.add('js-picker');
        })();

        function switchTab(tab) {
            const btnDb = document.querySelectorAll('.portal-tab')[0];
            const btnNexora = document.querySelectorAll('.portal-tab')[1];
            const formDb = document.getElementById('form-db');
            const formNexora = document.getElementById('form-nexora');
            const formChoice = document.getElementById('form-database-choice');
            const resetForm = document.querySelector('.database-reset-form');

            if (tab === 'db') {
                btnDb.classList.add('active');
                btnNexora.classList.remove('active');
                formDb.style.display = 'block';
                formNexora.style.display = 'none';
                if (formChoice) formChoice.style.display = 'none';
                if (resetForm) resetForm.style.display = 'none';
            } else {
                btnDb.classList.remove('active');
                btnNexora.classList.add('active');
                formDb.style.display = 'none';
                if (formChoice) {
                    formChoice.style.display = 'block';
                    formNexora.style.display = 'none';
                    if (resetForm) resetForm.style.display = 'block';
                } else {
                    formNexora.style.display = 'block';
                }
            }
        }

        function togglePass(inputId, btn) {
            const input = document.getElementById(inputId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.88 9.88 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>';
            } else {
                input.type = 'password';
                btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            }
        }
    </script>
</body>
</html>
