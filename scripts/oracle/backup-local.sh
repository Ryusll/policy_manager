#!/usr/bin/env bash
# 로컬 복구용 백업. 서버 소실에 대비한 외부 백업은 backup-offsite.sh로 별도 실행.
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose() { bash "$SCRIPT_DIR/compose.sh" "$@"; }
BACKUP_ROOT="${ORACLE_BACKUP_DIR:-$SCRIPT_DIR/../../backups/oracle}"
mkdir -p "$BACKUP_ROOT"
WORK="$(mktemp -d "$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
trap 'if [ ! -f "$WORK/COMPLETE" ]; then rm -rf "$WORK"; fi' EXIT
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$WORK/db.sql.gz"
# Compose가 선택한 api_uploads 볼륨을 사용한다. 다른 프로젝트의 볼륨은 검색하지 않는다.
compose run --rm -T --no-deps --entrypoint tar api -czf - -C /app/uploads . > "$WORK/uploads.tar.gz"
gzip -t "$WORK/db.sql.gz"
tar tzf "$WORK/uploads.tar.gz" >/dev/null
test "$(wc -c < "$WORK/db.sql.gz")" -gt 100
touch "$WORK/COMPLETE"
echo "DB/첨부파일 백업 완료: $WORK"
