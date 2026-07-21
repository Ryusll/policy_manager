# Runbook (배포·롤백)

작성일: 2026-07-21
근거: `docker-compose.yml`, `apps/api/Dockerfile`, `apps/api/docker-entrypoint.sh`, `apps/web/Dockerfile`, `apps/web/nginx.conf`. 단일 호스트 Docker Compose 배포 기준.

## 1. 서비스 구성 / 포트

| 서비스 | 컨테이너 포트 | 호스트 포트 | 비고 |
|---|---|---|---|
| postgres | 5432 | 5433 | DB `policy_manager`, `pg_bigm` 확장 |
| redis | 6379 | 6380 | |
| minio | 9000 / 9001 | 9000 / 9001 | 파일 스토리지(콘솔 9001), 버킷 `policy-files` |
| api | 3000 | 3001 | NestJS, `/api` prefix |
| web | 80 | 80 | nginx, `/api/` → api 프록시 |

## 2. 사전 준비

```bash
cp .env.example .env
```

`.env`에서 최소한 아래를 운영값으로 설정:

- `PUBLIC_URL` — 사용자가 브라우저에 입력하는 실제 URL (예: `https://your-domain.com`). CORS·OAuth 콜백에 사용됨
- (Google 로그인 사용 시) `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- (웹 푸터 표기) `VITE_PUBLIC_COMPANY_LEGAL_NAME`, `VITE_PUBLIC_COMPANY_REG_NO`

> **보안 필수**: `docker-compose.yml`에 하드코딩된 `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `MINIO_SECRET_KEY`는 운영 배포 전 반드시 교체할 것. 상세는 [15_보안검토서](../15_보안검토서/보안_검토서.md).

## 3. 최초 배포

```bash
npm run docker:up          # = docker compose up -d
npm run docker:logs        # 기동 로그 확인
```

`api` 컨테이너는 `docker-entrypoint.sh`에 따라 기동 시 자동으로:
1. `prisma migrate deploy` (실패 시 → 2로 폴백)
2. `prisma db push --accept-data-loss` (실패 시 FATAL 종료)
3. 데모 데이터 시드 (테넌트 `demo`, 계정 `admin@demo.com` / `password123`; seed.ts에는 `astrum`/`admin@astrum.com`도 포함)
4. `node dist/main`으로 서버 기동

> ⚠️ 2번 폴백(`db push --accept-data-loss`)은 스키마 불일치 시 **데이터 손실 가능성**이 있다. baseline 마이그레이션 부재로 인한 구조이며, 운영 데이터가 있는 환경에서는 폴백에 의존하지 말고 마이그레이션이 정상 적용되는지 먼저 확인할 것 ([13_기술부채대장](../13_기술부채대장/기술부채_대장.md) 항목 참고).

## 4. 코드 변경 재배포

```bash
# API/웹 소스 변경 시 이미지 재빌드 후 재기동
docker compose build api web
docker compose up -d api web

# 웹 변경이 반영 안 될 때 (캐시)
docker compose build --no-cache web && docker compose up -d web
```

## 5. 마이그레이션 수동 적용 (권장 운영 방식)

자동 폴백에 의존하지 않으려면 배포 시 명시적으로:

```bash
docker compose exec api npx prisma migrate deploy
```

시드가 실행되지 않았을 때:

```bash
docker compose exec api npx prisma db seed
```

## 6. 상태 확인

```bash
docker compose ps                     # 컨테이너/헬스 상태
curl -f http://localhost:3001/api/health   # API 헬스체크
# web: 브라우저에서 http://localhost (또는 PUBLIC_URL)
# Swagger: http://localhost:3001/api/docs
```

api 컨테이너 헬스체크는 `/api/health`를 5초 간격, start_period 60초로 확인한다.

## 7. 롤백

이 프로젝트는 이미지 태그 버전 관리·마이그레이션 down 스크립트가 정의되어 있지 않으므로, 롤백은 다음 원칙을 따른다:

1. **코드 롤백**: 직전 정상 커밋으로 소스를 되돌린 뒤 4번(재빌드·재기동) 수행
2. **DB 롤백**: Prisma 마이그레이션에 down 스크립트가 없으므로 스키마 자동 롤백 불가 →
   - 배포 전 반드시 DB 백업: `docker compose exec postgres pg_dump -U postgres policy_manager > backup_YYYYMMDD.sql`
   - 문제 발생 시 복원: `docker compose exec -T postgres psql -U postgres policy_manager < backup_YYYYMMDD.sql`
3. **볼륨 데이터**: `postgres_data`, `minio_data`, `api_uploads` 볼륨은 `docker compose down`으로는 삭제되지 않음. `down -v`는 볼륨까지 삭제하므로 **운영에서 절대 사용 금지**

## 8. 운영 체크리스트

- [ ] `.env`의 시크릿이 기본값이 아닌 운영값으로 교체되었는가
- [ ] `PUBLIC_URL`과 Google OAuth 콜백 URL이 일치하는가
- [ ] 배포 전 DB 백업(`pg_dump`)을 수행했는가
- [ ] 마이그레이션이 `migrate deploy`로 정상 적용되었는가 (폴백에 의존하지 않았는가)
- [ ] 통합 관리자(global_admin)에서 플랫폼 브랜딩 초기값을 설정했는가
- [ ] 헬스체크·주요 화면(로그인, 규정 목록/상세, 검색) 스모크 테스트를 통과했는가

## 9. 스모크 테스트 결과 (2026-07-21, 실측)

`docker compose up -d --build`를 실제 실행해 확인한 결과.

### 통과
- postgres·redis·api 컨테이너 healthy, minio·web 기동 정상
- API: `GET /api/health`→200, `/api/docs`(Swagger)→200, `GET /api/platform-branding`(공개)→200
- 인증: 미인증 `GET /api/policies`→401, 로그인(`admin@demo.com`/`password123`, tenant `demo`)→200(access+refresh 발급), `POST /api/auth/me`→200
- 데이터: `GET /api/policies`→200(샘플 규정 반환), `GET /api/search?q=…`→200
- web 컨테이너: SPA 정상 서빙(`<title>Veda · 베다</title>`), nginx `/api/` 프록시→api 200 (Docker 네트워크 내부에서 확인)

### 발견된 빌드 블로커 (문서와 현실의 차이 — [13_기술부채대장](../13_기술부채대장/기술부채_대장.md) #5~#8)
1. **Prisma 블록 주석**으로 `prisma generate` 실패 → 스모크 중 `///`로 수정(해결).
2. **pymupdf/pdfplumber pip 설치 실패**(Alpine musl) → 스모크에서는 해당 라인 임시 제외 후 진행. **근본 해결 필요**(미해결).
3. **apps/api 락파일 부재**로 클린 빌드가 최신 Prisma를 끌어와 1번을 표면화(미해결).
4. **baseline 마이그레이션 부재**로 `migrate deploy` 실패 → `db push --accept-data-loss` 폴백으로만 기동됨(실측 재현). 운영 데이터가 있으면 위험.

> 결론: **현재 클린 체크아웃에서는 위 2·3·4 때문에 본 Runbook의 배포 절차가 그대로 동작하지 않는다.** 위 항목 해소 후 재검증 필요.

### 환경 주의: 호스트 80 포트 충돌
검증 머신에 로컬 Kubernetes(ingress-nginx)가 호스트 `:80`을 점유하고 있어 web 컨테이너가 `:80`으로 게시되지 않았다(컨테이너는 정상, 호스트 노출만 실패). 동일 상황에서는 `docker-compose.yml`의 web 포트를 `"8080:80"` 등으로 바꾸거나 점유 프로세스를 내리고 기동할 것.

## 10. 향후 개선 (참고)

무중단 배포, 이미지 태그 기반 롤백, 마이그레이션 down 전략, 자동 백업 스케줄은 현재 미비. [02_WBS_작업분해](../02_WBS_작업분해/WBS_작업분해.md) WP2 참고.
