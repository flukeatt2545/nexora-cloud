#!/bin/sh
set -eu

cd /opt/app/nexora
docker build --pull --no-cache -t nexora-code-server:latest docker/code-server

containers="$(docker ps -a --format '{{.Names}}' | grep '^nexora-code-' | grep -v '^nexora-code-security-test$' || true)"
if [ -z "$containers" ]; then
  echo "recreated=0"
  exit 0
fi

recreated=0
for name in $containers; do
  network="$(docker inspect "$name" --format '{{.HostConfig.NetworkMode}}')"
  volume="$(docker inspect "$name" --format '{{range .Mounts}}{{if eq .Destination "/home/coder/project"}}{{.Name}}{{end}}{{end}}')"
  case "$name" in nexora-code-*) ;; *) echo "invalid_container=$name"; exit 1 ;; esac
  case "$network" in nexora-net-*) ;; *) echo "invalid_network=$network"; exit 1 ;; esac
  if [ -z "$volume" ]; then
    echo "missing_volume=$name"
    exit 1
  fi

  docker rm -f "$name" >/dev/null
  docker run -d \
    --name "$name" \
    --network "$network" \
    --restart unless-stopped \
    --label com.nexora.managed=true \
    --label com.nexora.kind=code-server \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 256 \
    --memory 512m \
    --memory-swap 512m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --tmpfs /home/coder/.local/share/code-server:rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0700 \
    -v "$volume":/home/coder/project:rw \
    nexora-code-server:latest >/dev/null
  recreated=$((recreated + 1))
done

sleep 5
failed=0
for name in $containers; do
  status="$(docker inspect "$name" --format '{{.State.Status}}')"
  if [ "$status" != "running" ]; then
    echo "$name=$status"
    failed=1
  fi
done

echo "recreated=$recreated"
exit "$failed"
