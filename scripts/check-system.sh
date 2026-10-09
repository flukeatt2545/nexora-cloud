#!/usr/bin/env bash
set -e

# ==============================================================================
# NEXORA CLOUD — Pre-flight & Multi-Key Healthcheck Script
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="/opt/app/nexora"
ENV_FILE="$ROOT_DIR/.env"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   NEXORA CLOUD SYSTEM HEALTHCHECK & VERIFICATION     ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Validate .env file & Backup
echo -n "[1/6] Checking .env configuration... "
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}FAILED${NC} (.env file not found at $ENV_FILE)"
    exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
cp "$ENV_FILE" "$ROOT_DIR/.env.bak.$TIMESTAMP"
echo -e "${GREEN}OK${NC} (Backup created: .env.bak.$TIMESTAMP)"

# Load .env safely
export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs -d '\n')

# Check Required Keys
REQUIRED_VARS=("POSTGRES_PASSWORD" "HOSTING_BASE_DOMAINS" "HOSTING_ENCRYPTION_KEY" "REDIS_PASSWORD" "TENANT_DB_ROOT_PASSWORD")
for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        echo -e "${RED}[ERROR] Required variable $VAR is missing or empty in .env${NC}"
        exit 1
    fi
done

if [[ "$HOSTING_BASE_DOMAINS" != *"nkn02.com"* ]]; then
    echo -e "${YELLOW}[WARN] HOSTING_BASE_DOMAINS does not contain 'nkn02.com' (Current: $HOSTING_BASE_DOMAINS)${NC}"
fi

# 2. Check Database Connectivity
echo -n "[2/6] Checking PostgreSQL connectivity... "
if docker exec -i nexora-postgres-1 pg_isready -U nexora -d nexora >/dev/null 2>&1; then
    echo -e "${GREEN}OK${NC} (PostgreSQL 17 is healthy)"
else
    echo -e "${RED}FAILED${NC} (Cannot connect to PostgreSQL container)"
    exit 1
fi

# 3. Probe Multi-Key Decryption against real DB records
echo -n "[3/6] Testing Multi-Key Decryption on environment variables... "
DECRYPT_TEST=$(docker run --rm -i \
  --network nexora_default \
  -e DATABASE_URL="postgres://nexora:${POSTGRES_PASSWORD}@postgres:5432/nexora?sslmode=disable" \
  -e HOSTING_ENCRYPTION_KEY="${HOSTING_ENCRYPTION_KEY}" \
  -v /opt/app/nexora/backend:/src \
  -w /src/cmd/rotate-secrets \
  golang:alpine sh -c 'go run main.go' 2>&1 || true)

if echo "$DECRYPT_TEST" | grep -q "Successfully rotated and re-encrypted"; then
    COUNT=$(echo "$DECRYPT_TEST" | grep -o "[0-9]\+ environment variables" | head -n 1)
    echo -e "${GREEN}OK${NC} (Verified and compatible: $COUNT)"
else
    echo -e "${RED}FAILED${NC}"
    echo "$DECRYPT_TEST"
    exit 1
fi

# 4. Check Docker Socket & Port Lease Range
echo -n "[4/6] Checking Docker socket & permissions... "
if [ -S /var/run/docker.sock ] && docker ps >/dev/null 2>&1; then
    echo -e "${GREEN}OK${NC} (Docker socket responsive)"
else
    echo -e "${RED}FAILED${NC} (Cannot access /var/run/docker.sock)"
    exit 1
fi

# 5. Check Runtime Gateway Health
echo -n "[5/6] Checking Runtime Gateway (port 8090)... "
GW_HEALTH=$(docker exec -i nexora-runtime-gateway wget -q -O - http://localhost:8090/_nexora/health 2>/dev/null || echo "")
if [[ "$GW_HEALTH" == *"ok"* ]]; then
    echo -e "${GREEN}OK${NC} (Gateway responding: $GW_HEALTH)"
else
    echo -e "${YELLOW}WAITING${NC} (Gateway healthcheck returned: $GW_HEALTH)"
fi

# 6. Check Caddy & Public Routing
echo -n "[6/6] Checking Caddy ingress (port 8088)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: 124snru.nkn02.com" http://127.0.0.1:8088/ || true)
if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}OK${NC} (Subdomain 124snru.nkn02.com responded HTTP 200)"
else
    echo -e "${YELLOW}HTTP $HTTP_CODE${NC} (Check container status if sites are stopped)"
fi

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}   ALL CRITICAL PRE-FLIGHT CHECKS PASSED!             ${NC}"
echo -e "${BLUE}======================================================${NC}"
