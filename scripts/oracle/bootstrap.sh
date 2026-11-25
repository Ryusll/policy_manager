#!/usr/bin/env bash
# 새 Oracle Ubuntu 서버에서 실행. Docker/Tailscale 공식 apt 저장소만 사용.
set -euo pipefail
[ -f /etc/os-release ] || { echo 'Ubuntu 서버에서 실행하세요.' >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo 'Ubuntu 서버에서 실행하세요.' >&2; exit 1; }
case "${VERSION_CODENAME:-}" in
  jammy|noble) ;;
  *) echo '지원 이미지: Ubuntu 22.04 / 24.04' >&2; exit 1 ;;
esac
sudo apt-get update
sudo apt-get install -y ca-certificates curl git python3

if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$VERSION_CODENAME" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
sudo docker compose version
sudo usermod -aG docker "${SUDO_USER:-$(id -un)}"

if [ "${INSTALL_TAILSCALE:-true}" = true ]; then
if ! command -v tailscale >/dev/null; then
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$VERSION_CODENAME.noarmor.gpg" \
    | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$VERSION_CODENAME.tailscale-keyring.list" \
    | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y tailscale
fi
sudo systemctl enable --now tailscaled
fi
echo '설치 완료. SSH를 끊고 재접속하여 Docker 그룹을 반영하세요.'
if [ "${INSTALL_TAILSCALE:-true}" = true ]; then
  echo '다음: sudo tailscale up --hostname=veda-app'
fi
