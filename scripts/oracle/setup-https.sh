#!/usr/bin/env bash
# Tailscale 없이 Caddy가 호스트에서 HTTPS를 종료하고 루프백 웹으로 전달한다.
set -euo pipefail
APP_HOST="${1:?사용법: bash scripts/oracle/setup-https.sh 호스트명}"
[[ "$APP_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$ ]] || { echo '호스트명만 입력하세요.' >&2; exit 1; }
curl -fsS http://127.0.0.1:8080/api/health >/dev/null
if ! command -v caddy >/dev/null; then
  sudo apt-get update
  # Ubuntu 저장소의 서명 검증된 패키지를 사용한다.
  sudo apt-get install -y caddy
fi
APP_CONFIG="$(mktemp)"
trap 'rm -f "$APP_CONFIG"' EXIT
printf '%s {\n\treverse_proxy 127.0.0.1:8080\n}\n' "$APP_HOST" > "$APP_CONFIG"
caddy validate --config "$APP_CONFIG" --adapter caddyfile
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -m 644 "$APP_CONFIG" /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
# Ubuntu OCI 기본 INPUT의 REJECT보다 먼저 허용. SSH/기존 규칙은 유지한다.
for APP_PORT in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$APP_PORT" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$APP_PORT" -m conntrack --ctstate NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save
sudo systemctl enable --now caddy
sudo systemctl reload caddy
echo "HTTPS 설정 완료: https://$APP_HOST (OCI 보안 목록에도 TCP 80/443 필요)"
