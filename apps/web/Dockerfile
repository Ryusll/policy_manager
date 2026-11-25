# 웹이 안 바뀌면: docker compose build --no-cache web && docker compose up -d web
FROM node:22-alpine AS builder
WORKDIR /app
# API와 같이 리포 루트의 워크스페이스 락파일을 사용한다.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace=apps/web --include-workspace-root=false --legacy-peer-deps
COPY apps/web ./apps/web
WORKDIR /app/apps/web
ARG VITE_PUBLIC_COMPANY_LEGAL_NAME=
ARG VITE_PUBLIC_COMPANY_REG_NO=
ENV VITE_PUBLIC_COMPANY_LEGAL_NAME=$VITE_PUBLIC_COMPANY_LEGAL_NAME
ENV VITE_PUBLIC_COMPANY_REG_NO=$VITE_PUBLIC_COMPANY_REG_NO
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
