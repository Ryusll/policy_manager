# 빌드 컨텍스트는 리포 루트다(docker-compose.yml 참고).
# 워크스페이스 락파일(package-lock.json)이 루트에만 있어서, 컨텍스트가 apps/api 이면
# 락파일 없이 `npm install` 이 매번 새로 해석된다(과거 Prisma 5.22 자동 상향으로 빌드가 깨진 원인).
#
# 베이스가 Debian(slim)인 이유: PDF 추출에 쓰는 PyMuPDF는 musllinux(Alpine) wheel을
# 제공하지 않아 Alpine에서는 소스 빌드로 넘어가다 실패한다(C 툴체인 부재, `cc` 127).
# 빌더·런너 모두 같은 베이스를 써야 builder에서 만든 Prisma 엔진을 런너가 그대로 쓸 수 있다.
FROM node:20-slim AS builder
WORKDIR /app
# Prisma 엔진은 generate/실행 시 OpenSSL이 필요하다 (Debian bookworm = OpenSSL 3.x)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 락파일 기반 재현 설치 (npm ci). 의존성 변경 시에만 이 레이어가 무효화된다.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace=apps/api --include-workspace-root=false --legacy-peer-deps

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build
RUN npx tsc -p tsconfig.seed.json
RUN test -f dist-seed/seed.js && ls -la dist-seed/

FROM node:20-slim AS runner
WORKDIR /app
# 파이썬 PDF 추출 의존성은 requirements.txt를 단일 소스로 사용한다.
# `--only-binary=:all:` : wheel이 없으면 소스 빌드로 새지 않고 즉시 실패시켜 원인을 드러낸다.
COPY apps/api/scripts/requirements.txt ./scripts/requirements.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init openssl ca-certificates python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages --only-binary=:all: -r ./scripts/requirements.txt \
  && apt-get purge -y python3-pip && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
# 워크스페이스 설치라 node_modules 는 루트에 호이스팅되어 있다
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/dist-seed ./dist-seed
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/scripts ./scripts
COPY apps/api/package.json ./package.json
COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
# Invoke via `sh` so CRLF in the script (Windows checkouts) cannot break the shebang with ENOENT.
CMD ["sh", "/app/docker-entrypoint.sh"]
