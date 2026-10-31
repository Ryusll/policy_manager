#!/usr/bin/env bash
# 법령 주기 동기화 (T-104). 서버 cron 이 하루 한 번 부른다:
#   30 4 * * * cd ~/policy_manager && bash scripts/oracle/law-sync.sh >> ~/law-sync.log 2>&1
# 하나라도 실패하면 종료 코드 1 — "개정 없음"과 "확인 못 함"이 섞이지 않게 한다.
# 인자는 그대로 넘긴다(예: --limit 50). 기본 20건, 확인이 오래된 법령부터.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[$(date '+%F %T')] law-sync 시작"
bash "$SCRIPT_DIR/compose.sh" exec -T api node dist/laws/law-sync.cli.js "$@"
