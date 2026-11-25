#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose() { bash "$SCRIPT_DIR/compose.sh" "$@"; }
PORT="$(compose port web 80)"
BASE_URL="http://$PORT"
curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/health" >/dev/null
curl --fail --silent --show-error --max-time 15 "$BASE_URL/" >/dev/null
[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE_URL/api/policies")" = 401 ]
[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE_URL/api/docs")" = 404 ]
echo '검증 통과: 웹 200 / API 헬스 200 / 미인증 규정 조회 401 / Swagger 404'
