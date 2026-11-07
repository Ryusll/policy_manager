#!/usr/bin/env bash
# 놓친 개정 후보 보충 (T-149, 운영 반영 뒤 한 번) — 런북 7-10. 서버의 ~/policy_manager 에서:
#   bash scripts/oracle/amendment-catchup.sh --plan 2>&1 | tee ~/amendment-catchup-plan-$(date +%Y%m%d%H%M).log
#   bash scripts/oracle/amendment-catchup.sh 2>&1 | tee ~/amendment-catchup-$(date +%Y%m%d%H%M).log
# 종료 코드: 0 성공(계획 포함), 1 실패, 2 상한을 넘어 만들지 않음(PM 확인 뒤 --max-total·--max-per-tenant). 인자는 그대로 넘긴다.
# tee 로 받으면 종료 코드 대신 마지막 요약 줄로 판단한다. 환경 변수는 쓰지 않는다(compose.sh 가 .env.oracle 로 띄운 api 컨테이너 안에서 돈다).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[$(date '+%F %T')] amendment-catchup 시작"
bash "$SCRIPT_DIR/compose.sh" exec -T api node dist/amendments/amendment-catchup.cli.js "$@"
