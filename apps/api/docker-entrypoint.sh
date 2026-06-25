#!/bin/sh
set -eu

# Brief pause so Postgres accepts connections right after healthcheck
sleep 2

echo "[startup] Running Prisma migrate deploy..."
if ! npx prisma migrate deploy; then
  echo "[startup] migrate deploy failed, continuing with db push fallback."
fi

echo "[startup] Running Prisma db push fallback/sync..."
if ! npx prisma db push --accept-data-loss; then
  echo "[startup] FATAL: prisma db push failed."
  exit 1
fi

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

echo "[startup] Starting API server..."
exec node dist/main
