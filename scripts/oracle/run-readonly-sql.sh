#!/usr/bin/env bash
# 운영 DB에 점검용 SQL을 **읽기 전용으로** 실행한다. Mac에서 돌린다.
#
#   ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/<파일>.sql
#
# 서버 주소는 저장소에 적지 않는다(공개 저장소). 접속할 때 넘긴다.
# 읽기 전용은 두 겹이다: SQL 파일이 READ ONLY 트랜잭션으로 열고 ROLLBACK 으로 닫으며,
# 접속 자체도 default_transaction_read_only=on 이라 파일에 쓰기 문이 섞여도 DB가 거절한다.
set -euo pipefail
: "${ORACLE_SSH:?ORACLE_SSH=ubuntu@<서버주소> 를 지정하세요}"
KEY="${ORACLE_SSH_KEY:-$HOME/.ssh/veda_oci}"
SQL_FILE="${1:?실행할 SQL 파일 경로를 넘기세요}"
[ -f "$SQL_FILE" ] || { echo "SQL 파일이 없습니다: $SQL_FILE" >&2; exit 1; }

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$ORACLE_SSH" \
  'cd ~/policy_manager && bash scripts/oracle/compose.sh exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -P pager=off"' \
  < "$SQL_FILE"
