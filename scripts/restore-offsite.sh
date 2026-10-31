#!/usr/bin/env bash
# 서버 밖 백업에서 되돌리기 — 그리고 **되돌아가는지 정기적으로 확인하기**.
#
# 복원해 본 적 없는 백업은 백업이 아니라 희망이다. 그래서 기본 동작은
# 안전한 `--verify` 다: 백업을 내려받아 **임시 DB에 넣어 보고** 원본과 대조한 뒤
# 임시 DB를 지운다. 운영 데이터는 건드리지 않는다.
#
# 실제 복구는 `--restore` 로만 하며, 확인 문구를 직접 입력해야 진행된다.
#
# 사용법:
#   bash scripts/restore-offsite.sh --verify            # 최신 백업 복원 검증(안전)
#   bash scripts/restore-offsite.sh --verify 2026-09-09T201602Z
#   bash scripts/restore-offsite.sh --restore <스탬프>  # 실제 복구(파괴적)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }
die() { printf '[%s] 실패: %s\n' "$(date +'%F %T')" "$*" >&2; exit 1; }

MODE="${1:---verify}"
STAMP_ARG="${2:-}"

env_get() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -1 | sed 's/^"//; s/"$//; s/[[:space:]]*$//'
}
POSTGRES_USER="${POSTGRES_USER:-$(env_get POSTGRES_USER)}"
POSTGRES_DB="${POSTGRES_DB:-$(env_get POSTGRES_DB)}"
S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-$(env_get BACKUP_S3_ENDPOINT)}"
S3_BUCKET="${BACKUP_S3_BUCKET:-$(env_get BACKUP_S3_BUCKET)}"
S3_KEY="${BACKUP_S3_ACCESS_KEY:-$(env_get BACKUP_S3_ACCESS_KEY)}"
S3_SECRET="${BACKUP_S3_SECRET_KEY:-$(env_get BACKUP_S3_SECRET_KEY)}"
S3_PREFIX="${BACKUP_S3_PREFIX:-$(env_get BACKUP_S3_PREFIX)}"
S3_PREFIX="${S3_PREFIX:-policy-manager}"

for required in S3_ENDPOINT S3_BUCKET S3_KEY S3_SECRET POSTGRES_USER POSTGRES_DB; do
  [ -n "${!required}" ] || die "$required 가 비어 있습니다."
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

proto="${S3_ENDPOINT%%://*}"; host="${S3_ENDPOINT#*://}"
MC_URL="$proto://$S3_KEY:$S3_SECRET@$host"
mc() { docker run --rm -i -e "MC_HOST_backup=$MC_URL" -v "$WORK":/w --entrypoint mc minio/mc:latest "$@"; }

# ── 어떤 백업을 볼 것인가 ──────────────────────────────────────────────
if [ -n "$STAMP_ARG" ]; then
  STAMP="$STAMP_ARG"
else
  STAMP="$(mc ls "backup/$S3_BUCKET/$S3_PREFIX/" | awk '{print $NF}' | tr -d '/' | sort | tail -1)"
  [ -n "$STAMP" ] || die "백업이 하나도 없습니다: $S3_BUCKET/$S3_PREFIX/"
fi
log "대상 백업: $S3_PREFIX/$STAMP"

mc cp "backup/$S3_BUCKET/$S3_PREFIX/$STAMP/db.sql.gz" /w/db.sql.gz >/dev/null || die "DB 백업 내려받기 실패"
mc cp "backup/$S3_BUCKET/$S3_PREFIX/$STAMP/uploads.tar.gz" /w/uploads.tar.gz >/dev/null || die "첨부 백업 내려받기 실패"
log "내려받기 완료"

psql_admin() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres "$@"; }

case "$MODE" in
  --verify)
    CHECK_DB="restore_check_$(date +%s)"
    log "임시 DB 에 복원해 본다: $CHECK_DB (운영 데이터는 건드리지 않음)"
    psql_admin -q -c "CREATE DATABASE \"$CHECK_DB\";" >/dev/null
    cleanup_db() { psql_admin -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";" >/dev/null 2>&1 || true; }
    trap 'cleanup_db; rm -rf "$WORK"' EXIT

    if ! gzip -dc "$WORK/db.sql.gz" | docker compose exec -T postgres \
        psql -U "$POSTGRES_USER" -d "$CHECK_DB" -v ON_ERROR_STOP=1 -q >/dev/null; then
      die "복원 중 오류가 났습니다. 이 백업으로는 되돌릴 수 없습니다."
    fi

    # 원본과 복원본의 행 수를 대조한다. "복원은 됐는데 비어 있는" 경우를 잡는다.
    count_rows() {
      docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$1" -t -A -F',' -c \
        "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
    }
    LIVE="$(count_rows "$POSTGRES_DB")"
    docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$CHECK_DB" -q -c "ANALYZE;" >/dev/null
    REST="$(count_rows "$CHECK_DB")"

    TABLES="$(printf '%s\n' "$REST" | grep -c . || true)"
    [ "$TABLES" -gt 0 ] || die "복원본에 테이블이 없습니다."
    log "복원본 테이블 ${TABLES}개"

    DIFF="$(diff <(printf '%s\n' "$LIVE") <(printf '%s\n' "$REST") || true)"
    if [ -n "$DIFF" ]; then
      log "원본과 행 수가 다른 테이블이 있습니다 (백업 이후 데이터가 바뀌었으면 정상):"
      printf '%s\n' "$DIFF" | head -20
    else
      log "행 수가 원본과 완전히 일치합니다."
    fi

    # 첨부: 아카이브 안 파일 수와 현재 볼륨 파일 수를 비교
    ARCH_FILES="$(docker run --rm -v "$WORK":/w alpine sh -c 'tar tzf /w/uploads.tar.gz | grep -vc "/$"' || echo 0)"
    UPLOAD_VOL="$(docker volume ls --format '{{.Name}}' | grep -m1 'api_uploads' || true)"
    LIVE_FILES="$(docker run --rm -v "$UPLOAD_VOL":/data:ro alpine sh -c 'find /data -type f | wc -l' | tr -d ' ')"
    log "첨부 파일 수 — 백업 ${ARCH_FILES}개 / 현재 ${LIVE_FILES}개"
    docker run --rm -v "$WORK":/w alpine tar tzf /w/uploads.tar.gz >/dev/null || die "첨부 아카이브가 손상됐습니다."

    log "검증 통과 — 이 백업으로 되돌릴 수 있습니다."
    ;;

  --restore)
    [ -n "$STAMP_ARG" ] || die "복구는 스탬프를 명시해야 합니다: --restore 2026-09-09T201602Z"
    echo "!! 운영 DB($POSTGRES_DB)와 첨부 볼륨을 이 백업으로 덮어씁니다."
    echo "!! 현재 데이터는 사라집니다. 진행하려면 RESTORE 를 입력하세요."
    read -r answer
    [ "$answer" = "RESTORE" ] || die "취소했습니다."

    log "API 중지"
    docker compose stop api web >/dev/null
    log "DB 복원"
    psql_admin -q -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" >/dev/null
    psql_admin -q -c "CREATE DATABASE \"$POSTGRES_DB\";" >/dev/null
    gzip -dc "$WORK/db.sql.gz" | docker compose exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q >/dev/null || die "DB 복원 실패"

    log "첨부 복원"
    UPLOAD_VOL="$(docker volume ls --format '{{.Name}}' | grep -m1 'api_uploads' || true)"
    docker run --rm -v "$UPLOAD_VOL":/data -v "$WORK":/w alpine \
      sh -c 'rm -rf /data/* && tar xzf /w/uploads.tar.gz -C /data' || die "첨부 복원 실패"

    log "API 재기동"
    docker compose start api web >/dev/null
    log "복구 완료: $STAMP"
    ;;

  *) die "모드를 알 수 없습니다: $MODE (--verify | --restore)" ;;
esac
