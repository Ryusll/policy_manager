#!/usr/bin/env bash
# 규정 질문 기록 파기 (T-146). 서버 cron 이 하루 한 번 부른다:
#   10 4 * * * cd ~/policy_manager && bash scripts/oracle/ai-qa-purge.sh >> ~/ai-qa-purge.log 2>&1
# 보관 기간(90일, 코드 상수 AI_QA_LOG_RETENTION_DAYS)보다 오래된 질문·답 기록을 지운다. 실패하면 종료 코드 1.
# 운영 AI 키를 넣기 전에 이 cron 을 먼저 걸어 둔다(런북 7-9).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[$(date '+%F %T')] ai-qa-purge 시작"
bash "$SCRIPT_DIR/compose.sh" exec -T api node dist/ask/ask-purge.cli.js
