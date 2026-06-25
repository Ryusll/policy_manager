# 웹이 안 바뀌면: docker compose build --no-cache web && docker compose up -d web
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
ARG VITE_PUBLIC_COMPANY_LEGAL_NAME=
ARG VITE_PUBLIC_COMPANY_REG_NO=
ENV VITE_PUBLIC_COMPANY_LEGAL_NAME=$VITE_PUBLIC_COMPANY_LEGAL_NAME
ENV VITE_PUBLIC_COMPANY_REG_NO=$VITE_PUBLIC_COMPANY_REG_NO
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
