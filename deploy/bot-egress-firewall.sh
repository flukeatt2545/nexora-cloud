#!/bin/sh
# Firewall for user Discord bots. runtime-worker puts every bot on the Docker network
# "nexora-bots" (bridge nxbots0, subnet BOT_NETWORK_SUBNET). Bots need the internet to reach
# Discord, but must not reach this server or anything on private addresses:
#   - forwarded traffic (DOCKER-USER): private, link-local, loopback and multicast ranges are
#     dropped, which also covers ports Docker publishes (they are DNAT-ed to 172.x addresses),
#     and SMTP (25) is dropped so a bot cannot send spam;
#   - traffic to the host itself (INPUT): everything new is dropped (SSH, the host Caddy...).
# Docker's DNS for containers answers inside each container, so it is not affected.
#
#   sudo sh deploy/bot-egress-firewall.sh            # apply now (safe to run again)
#   sudo sh deploy/bot-egress-firewall.sh install    # apply now and after every reboot
#   sudo sh deploy/bot-egress-firewall.sh remove     # take the rules out
set -eu

BRIDGE=nxbots0
FORWARD_CHAIN=NEXORA-BOTS
INPUT_CHAIN=NEXORA-BOTS-IN

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

remove_rules() {
  while iptables -C DOCKER-USER -i "$BRIDGE" -j "$FORWARD_CHAIN" 2>/dev/null; do
    iptables -D DOCKER-USER -i "$BRIDGE" -j "$FORWARD_CHAIN"
  done
  while iptables -C INPUT -i "$BRIDGE" -j "$INPUT_CHAIN" 2>/dev/null; do
    iptables -D INPUT -i "$BRIDGE" -j "$INPUT_CHAIN"
  done
  for chain in "$FORWARD_CHAIN" "$INPUT_CHAIN"; do
    if iptables -L "$chain" -n >/dev/null 2>&1; then
      iptables -F "$chain"
      iptables -X "$chain"
    fi
  done
}

apply_rules() {
  # Docker creates DOCKER-USER when it starts; make sure it exists if this runs first.
  iptables -L DOCKER-USER -n >/dev/null 2>&1 || iptables -N DOCKER-USER

  iptables -N "$FORWARD_CHAIN" 2>/dev/null || iptables -F "$FORWARD_CHAIN"
  iptables -A "$FORWARD_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  for range in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 224.0.0.0/4 0.0.0.0/8; do
    iptables -A "$FORWARD_CHAIN" -d "$range" -j DROP
  done
  iptables -A "$FORWARD_CHAIN" -p tcp --dport 25 -j DROP
  iptables -A "$FORWARD_CHAIN" -j RETURN

  iptables -N "$INPUT_CHAIN" 2>/dev/null || iptables -F "$INPUT_CHAIN"
  iptables -A "$INPUT_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  iptables -A "$INPUT_CHAIN" -j DROP

  iptables -C DOCKER-USER -i "$BRIDGE" -j "$FORWARD_CHAIN" 2>/dev/null || iptables -I DOCKER-USER 1 -i "$BRIDGE" -j "$FORWARD_CHAIN"
  iptables -C INPUT -i "$BRIDGE" -j "$INPUT_CHAIN" 2>/dev/null || iptables -I INPUT 1 -i "$BRIDGE" -j "$INPUT_CHAIN"
}

install_unit() {
  target=/usr/local/sbin/nexora-bot-firewall
  install -m 0755 "$0" "$target"
  cat > /etc/systemd/system/nexora-bot-firewall.service <<UNIT
[Unit]
Description=Firewall for NEXORA user Discord bots
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$target
ExecStop=$target remove

[Install]
WantedBy=multi-user.target docker.service
UNIT
  systemctl daemon-reload
  systemctl enable nexora-bot-firewall.service >/dev/null
}

case "${1:-apply}" in
  apply) apply_rules ;;
  install) apply_rules; install_unit ;;
  remove) remove_rules ;;
  *) echo "usage: $0 [apply|install|remove]" >&2; exit 2 ;;
esac

iptables -S "$FORWARD_CHAIN" 2>/dev/null || true
iptables -S "$INPUT_CHAIN" 2>/dev/null || true
