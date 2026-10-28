#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose() { bash "$SCRIPT_DIR/compose.sh" "$@"; }
compose config --format json | python3 "$SCRIPT_DIR/validate-config.py"
# 작은 A1에서도 API와 웹 빌드가 동시에 메모리를 점유하지 않게 한다.
COMPOSE_PARALLEL_LIMIT=1 compose build
compose pull postgres redis
if [ -n "$(compose ps --all --quiet postgres)" ]; then
  # 배포 중 쓰기를 멈춰 DB와 첨부파일을 같은 시점으로 보존한다.
  compose stop web api
  if ! bash "$SCRIPT_DIR/backup-local.sh"; then
    compose start api web
    echo '백업 실패: 새 컨테이너를 배포하지 않았습니다.' >&2
    exit 1
  fi
fi
if ! compose up -d --wait --wait-timeout 300; then
  compose ps --all
  echo '배포 실패. scripts/oracle/compose.sh logs --tail=100 api 로 원인을 확인하세요.' >&2
  exit 1
fi
bash "$SCRIPT_DIR/smoke.sh"
echo '서버 내부 검증 완료. Funnel 연결 후 공개 HTTPS 주소도 확인하세요.'
