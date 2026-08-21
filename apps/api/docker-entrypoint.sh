#!/bin/sh
set -eu

BASELINE_MIGRATION="00000000000000_init"

# Brief pause so Postgres accepts connections right after healthcheck
sleep 2

echo "[startup] Running Prisma migrate deploy..."
if npx prisma migrate deploy; then
  echo "[startup] migrate deploy completed."
else
  # 마이그레이션 이력보다 먼저 만들어진 DB(과거 db push 로 생성된 스키마 등)는
  # baseline 을 '적용됨'으로 표시한 뒤 나머지만 이어서 적용한다.
  # 예전처럼 `db push --accept-data-loss` 로 넘어가지 않는다(운영 데이터 손실 위험).
  echo "[startup] migrate deploy failed. Checking whether this is a pre-baseline database..."
  if echo 'SELECT 1 FROM "users" LIMIT 1;' | npx prisma db execute --stdin >/dev/null 2>&1; then
    echo "[startup] Existing schema detected. Baselining..."
    # baseline 이전 이력(스쿼시로 사라진 마이그레이션들)이 남아 있으면 실패 기록 때문에
    # 이후 마이그레이션이 막힌다(P3009). 현재 이력에 없는 행만 정리한다.
    # 현재 마이그레이션이 실패한 경우는 남겨서 사람이 확인하도록 둔다.
    echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name NOT IN ('${BASELINE_MIGRATION}', '00000000000001_enable_pgbigm');" \
      | npx prisma db execute --stdin >/dev/null 2>&1 || true
    echo "[startup] Marking ${BASELINE_MIGRATION} as applied (baseline)..."
    npx prisma migrate resolve --applied "${BASELINE_MIGRATION}" >/dev/null 2>&1 || true
    echo "[startup] Retrying migrate deploy..."
    npx prisma migrate deploy
  else
    echo "[startup] FATAL: migrate deploy failed and no existing schema was found."
    echo "[startup] Fix the migration history before starting (see docs/Deliverables/16_Runbook_배포롤백)."
    exit 1
  fi
fi

# 데모 시드는 공개 주소로 공유하는 순간 위험해진다.
# 시드가 만드는 admin@demo.com / password123 은 리포에 그대로 적혀 있어 공개된 것과 같다.
# 터널·상시 서버 등 외부에서 접근 가능한 배포에서는 .env 에 SEED_DEMO_DATA=false 를 둔다.
# (시드를 꺼도 최초 조직은 POST /api/auth/register 로 만들 수 있다.)
if [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  echo "[startup] Seeding demo data (tenant: demo, admin@demo.com / password123)..."
  SEEDED=0
  if [ -f dist-seed/seed.js ] && node dist-seed/seed.js; then
    SEEDED=1
    echo "[startup] dist-seed/seed.js completed."
  elif npx prisma db seed; then
    SEEDED=1
    echo "[startup] prisma db seed completed."
  fi
  if [ "$SEEDED" != 1 ]; then
    echo "[startup] WARNING: demo seed did not run. Fix with: docker compose exec api npx prisma db seed"
  fi
else
  echo "[startup] SEED_DEMO_DATA=false -> skipping demo seed (no demo accounts will be created)."
fi

echo "[startup] Starting API server..."
exec node dist/main
