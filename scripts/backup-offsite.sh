#!/usr/bin/env bash
# 서버 밖으로 내보내는 백업 (DB + 첨부파일).
#
# 왜 필요한가: 지금까지의 백업 절차는 `pg_dump > backup_YYYYMMDD.sql` 로
# **같은 서버 안에** 파일을 만들었다. 배포하다 잘못됐을 때 되돌리는 용도로는
# 되지만, 서버 자체가 사라지면 백업도 같이 사라진다. Always Free 인스턴스는
# 유휴 상태가 이어지면 회수되기도 한다.
#
# 그리고 **첨부파일은 DB 백업에 들어 있지 않다.** 규정 본문은 Postgres 에,
# 첨부는 `api_uploads` 볼륨에 따로 있다. 둘 다 내보내야 복구가 성립한다.
#
# S3 호환 저장소면 어디든 된다(Oracle Object Storage, AWS S3, 다른 MinIO).
# 저장소 클라이언트는 컨테이너로 실행하므로 서버에 따로 설치할 것이 없다.
#
# 사용법:  bash scripts/backup-offsite.sh
# cron 예: 0 3 * * * cd /path/to/repo && bash scripts/backup-offsite.sh >> /var/log/policy-backup.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }
die() { printf '[%s] 실패: %s\n' "$(date +'%F %T')" "$*" >&2; exit 1; }

# ── 설정 읽기 ──────────────────────────────────────────────────────────
# `.env` 는 셸 문법이 아닌 줄이 섞일 수 있어 source 하지 않고 필요한 키만 뽑는다.
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
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(env_get BACKUP_KEEP_DAYS)}"
S3_PREFIX="${S3_PREFIX:-policy-manager}"
KEEP_DAYS="${KEEP_DAYS:-30}"

for required in S3_ENDPOINT S3_BUCKET S3_KEY S3_SECRET POSTGRES_USER POSTGRES_DB; do
  [ -n "${!required}" ] || die "$required 가 비어 있습니다. .env 를 확인하세요(값은 로그에 남기지 않습니다)."
done

# 이 백업이 실제로 담아야 할 최소 크기. 0바이트 산출물을 성공으로 넘기지 않기 위한 것이다.
MIN_DB_BYTES=1024

STAMP="$(date +'%Y-%m-%dT%H%M%SZ')"
DEST="$S3_PREFIX/$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 1) DB ─────────────────────────────────────────────────────────────
# `pg_dump > 파일` 은 pg_dump 가 실패해도 리다이렉트가 성공해 빈 파일이 남는다.
# 종료 코드와 크기를 모두 본다.
log "DB 덤프: $POSTGRES_DB"
if ! docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
      | gzip -9 > "$WORK/db.sql.gz"; then
  die "pg_dump 가 실패했습니다."
fi
DB_BYTES="$(wc -c < "$WORK/db.sql.gz" | tr -d ' ')"
[ "$DB_BYTES" -ge "$MIN_DB_BYTES" ] || die "DB 덤프가 너무 작습니다(${DB_BYTES}바이트). 내용이 비었을 수 있습니다."
log "DB 덤프 완료: ${DB_BYTES}바이트"

# ── 2) 첨부파일 ───────────────────────────────────────────────────────
# 볼륨 이름은 compose 프로젝트명에 따라 달라진다. 이름으로 찾는다.
UPLOAD_VOL="$(docker volume ls --format '{{.Name}}' | grep -m1 'api_uploads' || true)"
[ -n "$UPLOAD_VOL" ] || die "api_uploads 볼륨을 찾지 못했습니다. 스택이 떠 있는지 확인하세요."
log "첨부 볼륨: $UPLOAD_VOL"
docker run --rm -v "$UPLOAD_VOL":/data:ro -v "$WORK":/out alpine \
  tar czf /out/uploads.tar.gz -C /data . || die "첨부 아카이브 생성 실패"
UP_BYTES="$(wc -c < "$WORK/uploads.tar.gz" | tr -d ' ')"
UP_FILES="$(docker run --rm -v "$WORK":/w alpine sh -c 'tar tzf /w/uploads.tar.gz | grep -vc "/$"' || echo 0)"
log "첨부 아카이브 완료: ${UP_BYTES}바이트 / 파일 ${UP_FILES}개"

# ── 3) 올리기 ─────────────────────────────────────────────────────────
# MC_HOST_* 환경변수를 쓰면 자격증명이 파일로 남지 않는다.
mc() {
  docker run --rm -i \
    -e "MC_HOST_backup=$S3_ENDPOINT" \
    -v "$WORK":/w \
    --entrypoint mc minio/mc:latest "$@"
}
# 자격증명은 엔드포인트 URL 에 실어 넣는다(로그에 찍지 않는다).
proto="${S3_ENDPOINT%%://*}"
host="${S3_ENDPOINT#*://}"
S3_ENDPOINT="$proto://$S3_KEY:$S3_SECRET@$host"

log "업로드: $S3_BUCKET/$DEST"
mc cp /w/db.sql.gz "backup/$S3_BUCKET/$DEST/db.sql.gz" >/dev/null || die "DB 백업 업로드 실패"
mc cp /w/uploads.tar.gz "backup/$S3_BUCKET/$DEST/uploads.tar.gz" >/dev/null || die "첨부 백업 업로드 실패"

# ── 4) 올라간 것을 실제로 확인 ─────────────────────────────────────────
# 올리는 명령이 성공했다는 것과 저장소에 남았다는 것은 다르다. 크기를 대조한다.
verify() {
  local name="$1" expect="$2" got
  got="$(mc --json stat "backup/$S3_BUCKET/$DEST/$name" | sed -n 's/.*"size":\([0-9]*\).*/\1/p' | head -1)"
  [ "$got" = "$expect" ] || die "$name 크기가 다릅니다(올린 값 $expect, 저장소 $got)."
  log "확인: $name ${got}바이트"
}
verify db.sql.gz "$DB_BYTES"
verify uploads.tar.gz "$UP_BYTES"

# ── 5) 오래된 백업 정리 ───────────────────────────────────────────────
log "보관 기간 정리: ${KEEP_DAYS}일 초과분"
mc rm --recursive --force --older-than "${KEEP_DAYS}d" "backup/$S3_BUCKET/$S3_PREFIX/" >/dev/null 2>&1 || true

log "완료: $S3_BUCKET/$DEST (DB ${DB_BYTES}B, 첨부 ${UP_BYTES}B/${UP_FILES}개)"
