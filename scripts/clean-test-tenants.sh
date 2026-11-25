#!/bin/sh
# 통합 테스트가 만든 테넌트를 지운다 (로컬 개발 DB 전용).
#
# 테스트는 매 실행마다 `it-` 로 시작하는 테넌트를 새로 만든다. 서로의 데이터를
# 보지 않게 하려는 것이라 의도된 동작이지만, 개발 DB에는 계속 쌓인다.
# CI는 매번 빈 DB라 이 스크립트가 필요 없다.
#
# 접속 계정은 **컨테이너 안의 환경변수**를 그대로 쓴다. 호스트 셸에는 `.env` 가
# 로드돼 있지 않아서, 여기서 기본값(`postgres`)을 두면 실제 계정과 어긋난다.
set -eu

psql_in_db() {
  docker compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" '"$1"
}

echo "지울 테넌트:"
psql_in_db "-t -A -c \"SELECT slug FROM tenants WHERE slug LIKE 'it-%';\""

psql_in_db "-c \"DELETE FROM tenants WHERE slug LIKE 'it-%';\""
echo "완료 (하위 데이터는 FK Cascade 로 함께 삭제됨)"
