FROM node:20-alpine AS builder
WORKDIR /app
# Prisma engines need OpenSSL at generate time; Alpine is musl + OpenSSL 3.x
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npx tsc -p tsconfig.seed.json
RUN test -f dist-seed/seed.js && ls -la dist-seed/

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache dumb-init openssl libc6-compat python3 py3-pip \
  && pip3 install --no-cache-dir --break-system-packages pdfplumber pymupdf
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-seed ./dist-seed
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY package*.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
# Invoke via `sh` so CRLF in the script (Windows checkouts) cannot break the shebang with ENOENT.
CMD ["sh", "/app/docker-entrypoint.sh"]
