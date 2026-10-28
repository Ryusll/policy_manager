#!/usr/bin/env bash
# Oracle Object Storage의 S3 호환 API 사용. 서버에 AWS CLI/Node 설치 불필요.
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_DIR"
ENV_PATH="${ORACLE_ENV_FILE:-$REPO_DIR/.env.oracle}"
[ -f "$ENV_PATH" ] || { echo '.env.oracle이 없습니다.' >&2; exit 1; }
env_get() { sed -n "s/^$1=//p" "$ENV_PATH" | tail -1 | sed "s/^[\"']//; s/[\"']$//"; }
S3_ENDPOINT="$(env_get BACKUP_S3_ENDPOINT)"
S3_BUCKET="$(env_get BACKUP_S3_BUCKET)"
S3_PREFIX="$(env_get BACKUP_S3_PREFIX)"
S3_PREFIX="${S3_PREFIX:-policy-manager-oracle}"
export AWS_ACCESS_KEY_ID="$(env_get BACKUP_S3_ACCESS_KEY)"
export AWS_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_KEY)"
export AWS_DEFAULT_REGION="$(env_get BACKUP_S3_REGION)"
for required in S3_ENDPOINT S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION; do
  [ -n "${!required}" ] || { echo "$required 설정이 비어 있습니다. .env.oracle을 확인하세요." >&2; exit 1; }
done
[[ "$S3_ENDPOINT" == https://* ]] || { echo '백업 엔드포인트는 HTTPS여야 합니다.' >&2; exit 1; }
MODE="${1:-backup}"
if [ "$MODE" != backup ] && [ "$MODE" != --verify ]; then
  echo '사용: backup-offsite.sh [backup | --verify 백업스탬프]' >&2; exit 1
fi
if [ "$MODE" = --verify ] && ! [[ "${2:-}" =~ ^[0-9]{8}T[0-9]{6}Z\.[a-zA-Z0-9]+$ ]]; then
  echo '--verify 뒤에 백업 완료 시 출력된 스탬프를 지정하세요.' >&2; exit 1
fi
WORK="$(mktemp -d)"
CHECK_DB=''
compose() { bash "$SCRIPT_DIR/compose.sh" "$@"; }
cleanup() {
  if [ -n "$CHECK_DB" ]; then
    compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$CHECK_DB" || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
aws() {
  docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    -e AWS_EC2_METADATA_DISABLED=true -e AWS_PAGER= -v "$WORK":/backups \
    "${ORACLE_AWS_CLI_IMAGE:-public.ecr.aws/aws-cli/aws-cli@sha256:83f8ffe939569070c5b66d22231862ab78718766d9d8e4c44ca84dd0be5569a5}" \
    --endpoint-url "$S3_ENDPOINT" "$@"
}

if [ "$MODE" = backup ]; then
  ORACLE_BACKUP_DIR="$WORK" bash "$SCRIPT_DIR/backup-local.sh"
  LOCAL_DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d)"
  STAMP="$(basename "$LOCAL_DIR")"
  python3 - "$LOCAL_DIR" <<'PY'
import hashlib, pathlib, sys
p = pathlib.Path(sys.argv[1])
with (p / 'SHA256SUMS').open('w') as manifest:
    for name in ('db.sql.gz', 'uploads.tar.gz'):
        h = hashlib.sha256()
        with (p / name).open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        manifest.write(f'{h.hexdigest()}  {name}\n')
PY
  # SHA256SUMS가 마지막에 올라가므로, 이것이 없는 디렉터리는 미완료 백업이다.
  for name in db.sql.gz uploads.tar.gz SHA256SUMS; do
    aws s3 cp "/backups/$STAMP/$name" "s3://$S3_BUCKET/$S3_PREFIX/$STAMP/$name" --only-show-errors
    expected="$(wc -c < "$LOCAL_DIR/$name" | tr -d ' ')"
    actual="$(aws s3api head-object --bucket "$S3_BUCKET" --key "$S3_PREFIX/$STAMP/$name" --query ContentLength --output text)"
    [ "$actual" = "$expected" ] || { echo "백업 크기 검증 실패: $name" >&2; exit 1; }
  done
  echo "서버 밖 백업 완료: $STAMP"
  echo "복원 검증: bash scripts/oracle/backup-offsite.sh --verify $STAMP"
else
  STAMP="$2"
  for name in SHA256SUMS db.sql.gz uploads.tar.gz; do
    aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$STAMP/$name" "/backups/$name" --only-show-errors
  done
  python3 - "$WORK" <<'PY'
import hashlib, pathlib, sys
p = pathlib.Path(sys.argv[1])
expected = dict(line.split('  ', 1)[::-1] for line in (p / 'SHA256SUMS').read_text().splitlines())
if set(expected) != {'db.sql.gz', 'uploads.tar.gz'}:
    sys.exit('백업 해시 목록이 올바르지 않습니다.')
for name, digest in expected.items():
    h = hashlib.sha256()
    with (p / name).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    if h.hexdigest() != digest:
        sys.exit(f'백업 해시 불일치: {name}')
PY
  gzip -t "$WORK/db.sql.gz"
  tar tzf "$WORK/uploads.tar.gz" >/dev/null
  CHECK_DB="oracle_verify_$(date +%s)_$$"
  compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$CHECK_DB"
  gzip -dc "$WORK/db.sql.gz" | compose exec -T postgres \
    sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -q' sh "$CHECK_DB" >/dev/null
  echo "해시·첨부파일 압축·임시 DB 복원 검증 완료: $STAMP"
fi
