#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
ENV_PATH="${ORACLE_ENV_FILE:-$REPO_DIR/.env.oracle}"
if [ ! -f "$ENV_PATH" ]; then
  echo '운영 환경 파일이 없습니다: python3 scripts/oracle/init-env.py https://실제호스트.ts.net' >&2
  exit 1
fi
exec docker compose --project-name "${ORACLE_PROJECT_NAME:-policy-manager-oracle}" \
  --env-file "$ENV_PATH" -f "$REPO_DIR/docker-compose.oracle.yml" "$@"
