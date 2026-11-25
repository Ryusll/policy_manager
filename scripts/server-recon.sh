#!/bin/sh
# 서버 현황 조사 — 읽기 전용. 아무것도 바꾸지 않는다.
#
# 모르는 서버에 배포하기 전에 "무엇이 어떻게 돌고 있는지"부터 확정한다.
# 서버에 ssh로 들어가 프로젝트 디렉터리에서 실행:  sh scripts/server-recon.sh
# 출력에 시크릿 값은 찍지 않는다(키 이름과 설정 여부만).

set -u
echo "===== 1. 호스트 ====="
uname -a 2>/dev/null
echo "docker : $(docker --version 2>/dev/null || echo 없음)"
echo "compose: $(docker compose version 2>/dev/null || echo 없음)"
echo "디스크 여유:"; df -h . 2>/dev/null | tail -1

echo
echo "===== 2. 실행 중인 컨테이너 ====="
docker compose ps 2>/dev/null || docker ps 2>/dev/null

echo
echo "===== 3. 이미지 생성 시각 (배포 시점 추정) ====="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.ID}}' 2>/dev/null | head -20

echo
echo "===== 4. 소스 위치와 git 상태 ====="
echo "현재 경로: $(pwd)"
if [ -d .git ]; then
  echo "브랜치  : $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo "HEAD    : $(git log -1 --format='%h %ad %s' --date=short 2>/dev/null)"
  echo "미커밋  :"; git status --short 2>/dev/null | head -20
else
  echo "!! git 저장소가 아님 — 소스 없이 이미지만 배포됐을 수 있음"
fi

echo
echo "===== 5. .env 키 목록 (값은 감춤) ====="
if [ -f .env ]; then
  sed -E 's/=.*/= <설정됨>/' .env | grep -v '^\s*#' | grep -v '^\s*$'
else
  echo "!! .env 없음 — compose 기본값(리포에 공개된 값)으로 돌고 있을 가능성"
fi

echo
echo "===== 6. 기본 시크릿 사용 여부 (가장 중요) ====="
docker compose config 2>/dev/null \
  | grep -cE 'your-super-secret|minioadmin123|postgres:postgres@' \
  | sed 's/^/  기본값 잔존 항목 수: /'
echo "  (0이 아니면 재배포 시 API가 부팅을 거부한다)"

echo
echo "===== 7. DB 상태 ====="
DB_USER="${POSTGRES_USER:-postgres}"; DB_NAME="${POSTGRES_DB:-policy_manager}"
PSQL="docker compose exec -T postgres psql -U $DB_USER -d $DB_NAME -t -A"
echo "-- 마이그레이션 이력:"
$PSQL -c "SELECT migration_name, (finished_at IS NOT NULL) FROM _prisma_migrations ORDER BY started_at;" 2>/dev/null \
  || echo "  (_prisma_migrations 없음 — db push로 만든 DB일 수 있음)"
echo "-- 스키마 존재 확인 (t/f):"
for t in sections policy_revision_reasons; do
  printf "   %-24s " "$t"
  $PSQL -c "SELECT to_regclass('public.$t') IS NOT NULL;" 2>/dev/null || echo "?"
done
printf "   %-24s " "article_versions.effective_date"
$PSQL -c "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='article_versions' AND column_name='effective_date');" 2>/dev/null || echo "?"
echo "-- 실데이터 규모:"
$PSQL -c "SELECT 'tenants='||(SELECT count(*) FROM tenants)||' users='||(SELECT count(*) FROM users)||' policies='||(SELECT count(*) FROM policies)||' articles='||(SELECT count(*) FROM articles)||' versions='||(SELECT count(*) FROM article_versions);" 2>/dev/null

echo
echo "===== 조사 끝 — 이 출력을 그대로 공유하면 배포 절차를 확정할 수 있다 ====="
