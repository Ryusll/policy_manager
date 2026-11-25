#!/usr/bin/env bash
#
# 로컬 개발서버 실행 — 화면을 고치는 즉시 반영된다(도커 재빌드 불필요).
#
# 구성: Vite(:5173)가 화면을 서빙하고 /api 요청을 Nest(:3000)로 프록시한다.
#       DB·Redis는 이미 떠 있는 도커 컨테이너를 호스트 포트로 그대로 쓴다.
#       따라서 도커로 보던 것과 같은 데이터를 본다.
#
# 도커 배포판(:8080)과 동시에 띄워도 서로 간섭하지 않는다. 포트도 DB 연결도 별개다.
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "❌ .env 가 없습니다. .env.example 을 복사해 채우세요."; exit 1; }

# .env 의 값을 그대로 재사용한다(비밀값을 두 곳에 복사해 두면 반드시 어긋난다).
set -a; . ./.env; set +a

# 도커 서비스가 떠 있어야 한다 — 여기서 걸러주지 않으면 Prisma가 한참 뒤에 죽는다.
for svc in postgres redis; do
  if ! docker compose ps --format '{{.Service}}:{{.Status}}' 2>/dev/null | grep -q "^${svc}:Up"; then
    echo "❌ 도커 ${svc} 가 떠 있지 않습니다. 먼저 실행하세요:"
    echo "     docker compose up -d postgres redis"
    exit 1
  fi
done

# 포트 선점 확인. 이미 떠 있는데 또 띄우면 원인 모를 오류로 보인다.
for port in 3000 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 포트 ${port} 가 이미 사용 중입니다. 기존 개발서버를 끄고 다시 실행하세요."
    exit 1
  fi
done

# 비밀번호에 base64 특수문자(+ / =)가 있으면 URL로 못 쓴다. 반드시 인코딩해야 한다.
PW_ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]||""))' "${POSTGRES_PASSWORD:-postgres}")

# 컨테이너 내부 이름(postgres:5432)이 아니라 호스트로 발행된 포트를 쓴다.
export DATABASE_URL="postgresql://${POSTGRES_USER:-postgres}:${PW_ENC}@localhost:5433/${POSTGRES_DB:-policy_manager}"
export REDIS_URL="redis://localhost:6380"
export PORT=3000
export NODE_ENV=development

echo "▶ API   http://localhost:3000/api/health"
echo "▶ 화면  http://localhost:5173      ← 여기로 접속"
echo "  (도커 배포판은 http://localhost:8080 에서 그대로 돕니다)"
echo "  중지: Ctrl+C"
echo

exec npm run dev
