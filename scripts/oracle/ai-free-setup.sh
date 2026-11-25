#!/usr/bin/env bash
# 운영 서버에서 규정 질문을 무료 제공사 묶음(freellmapi, T-208)으로 켠다. Mac 에서 돌린다(서버 쓰기 — 사용자가 실행).
#
#   ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/ai-free-setup.sh
#
# 먼저 새 코드를 배포해 둔다(deploy.sh — freellmapi 구성이 서버에 있어야 한다). 이 스크립트는
#  1) Mac .env 의 FREELLMAPI_GOOGLE_KEY·FREELLMAPI_GROQ_KEY 를 표준 입력으로만 넘겨(명령줄·셸 기록에 남지 않게)
#     서버 .env.oracle 을 고친다(scripts/oracle/ai-free-env.py — 값은 찍지 않는다, 이전 파일은 .bak 으로 남긴다)
#  2) 운영 설정을 검사하고 freellmapi 를 띄운 뒤 api·web 을 새 env 로 다시 만든다
#  3) freellmapi 부팅 정책 결과와 api 의 제공사·고지 판을 보여 준다
# 그 다음은 런북 7-9-1 의 시험 회사 확인(고지 확인·질문)이다. 되돌리기도 7-9-1.
set -euo pipefail
: "${ORACLE_SSH:?ORACLE_SSH=ubuntu@<서버주소> 를 지정하세요}"
KEY="${ORACLE_SSH_KEY:-$HOME/.ssh/veda_oci}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

val() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
GOOGLE="$(val FREELLMAPI_GOOGLE_KEY || true)"
GROQ="$(val FREELLMAPI_GROQ_KEY || true)"
echo "[1/3] Mac .env 의 제공사 키 — Google: $([ -n "$GOOGLE" ] && echo 있음 || echo 없음), Groq: $([ -n "$GROQ" ] && echo 있음 || echo 없음)"
[ -n "$GOOGLE$GROQ" ] || { echo "Mac .env 에 FREELLMAPI_GOOGLE_KEY·FREELLMAPI_GROQ_KEY 를 넣고 다시 실행하세요" >&2; exit 1; }

# 키 두 줄을 표준 입력으로 넘긴다 — 원격 명령에는 값이 없다
printf '%s\n%s\n' "$GOOGLE" "$GROQ" | ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$ORACLE_SSH" \
  'set -euo pipefail; cd ~/policy_manager
   test -f scripts/freellm/freellm-run.sh || { echo "서버에 T-208 코드가 없습니다 — 먼저 deploy.sh 로 배포하세요" >&2; exit 1; }
   python3 scripts/oracle/ai-free-env.py
   echo "[2/3] 운영 설정 검사 → freellmapi 띄우기 → api·web 다시 만들기"
   bash scripts/oracle/compose.sh config --format json | python3 scripts/oracle/validate-config.py
   bash scripts/oracle/compose.sh up -d --wait --wait-timeout 300 freellmapi
   bash scripts/oracle/compose.sh up -d --wait --wait-timeout 300 --force-recreate api web
   echo "[3/3] 결과"
   bash scripts/oracle/compose.sh logs --no-color freellmapi 2>&1 | grep -E "freellm-init|applied FREEAPI_CONFIG_JSON" | tail -3
   bash scripts/oracle/compose.sh exec -T api node -e "const k=require(\"./dist/ask/ask-provider-kind\");const n=require(\"./dist/ask/ask-notice\");console.log(\"api 제공사:\",k.askProviderKind(),\"· 고지 판:\",n.currentNoticeVersion())"
   bash scripts/oracle/compose.sh ps freellmapi api web'
echo "끝 — 런북 7-9-1 의 4번(시험 회사에서 고지 확인·질문)을 이어서 하세요"
