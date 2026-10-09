#!/bin/sh
set -eu

data_dir="/home/coder/.local/share/code-server"
mkdir -p "$data_dir/User"
if [ ! -f "$data_dir/User/settings.json" ]; then
  cp /usr/local/share/nexora-code/settings.json "$data_dir/User/settings.json"
fi

exec /usr/bin/entrypoint.sh \
  --bind-addr 0.0.0.0:8080 \
  --auth none \
  --disable-telemetry \
  /home/coder/project
