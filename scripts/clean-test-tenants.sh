#!/bin/sh
# 통합 테스트가 만든 테넌트를 지운다 (로컬 개발 DB 전용).
#
# 테스트는 매 실행마다 `it-` 로 시작하는 테넌트를 새로 만든다. 서로의 데이터를
# 보지 않게 하려는 것이라 의도된 동작이지만, 개발 DB에는 계속 쌓인다.
# CI는 매번 빈 DB라 이 스크립트가 필요 없다.
set -eu
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-policy_manager}"

echo "지울 테넌트:"
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  -c "SELECT slug FROM tenants WHERE slug LIKE 'it-%';"

docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c \
  "DELETE FROM tenants WHERE slug LIKE 'it-%';"
echo "완료 (하위 데이터는 FK Cascade 로 함께 삭제됨)"
