# Runbook (배포·롤백)

작성일: 2026-07-21
근거: `docker-compose.yml`, `apps/api/Dockerfile`, `apps/api/docker-entrypoint.sh`, `apps/web/Dockerfile`, `apps/web/nginx.conf`. 단일 호스트 Docker Compose 배포 기준.

## 1. 서비스 구성 / 포트

| 서비스 | 컨테이너 포트 | 호스트 포트 | 비고 |
|---|---|---|---|
| postgres | 5432 | 5433 | DB `policy_manager`, `pg_bigm` 확장 |
| redis | 6379 | 6380 | |
| minio | 9000 / 9001 | 9000 / 9001 | **현재 쓰이지 않는다.** 코드에 MinIO 클라이언트가 없고 `STORAGE_TYPE` 을 읽는 곳도 없다. 첨부파일은 api 컨테이너의 `api_uploads` 볼륨(`/app/uploads`)에 저장된다. 버킷 `policy-files` 도 만들어진 적이 없다 — 저장 위치 확정은 결정 대기 D-06 |
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
1. `prisma migrate deploy`
2. (1이 실패하고 **기존 스키마가 있으면**) baseline 이전 DB로 보고 자동 처리 — 옛 이력 행 정리 → `00000000000000_init`을 applied로 표시 → `migrate deploy` 재시도
3. 그래도 실패하면 **FATAL 종료** (데이터를 덮어쓰지 않는다)
4. 데모 데이터 시드 (테넌트 `demo`, 계정 `admin@demo.com` / `password123`; seed.ts에는 `astrum`/`admin@astrum.com`도 포함)
5. `node dist/main`으로 서버 기동

> 2026-08-02부터 `db push --accept-data-loss` 폴백은 **제거**됐다([ADR-0012](../10_ADR_의사결정기록/ADR.md)). 스키마는 마이그레이션으로만 반영되며, 실패는 조용히 넘어가지 않고 컨테이너를 멈춘다.

## 4. 코드 변경 재배포

```bash
# API/웹 소스 변경 시 이미지 재빌드 후 재기동
docker compose build api web
docker compose up -d api web

# 웹 변경이 반영 안 될 때 (캐시)
docker compose build --no-cache web && docker compose up -d web
```

## 5. 마이그레이션 수동 적용

기동 시 자동 적용되지만, 배포 절차상 명시적으로 확인하려면:

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
4. **첨부파일 백업**: 규정 첨부는 DB가 아니라 `api_uploads` 볼륨에만 있다. `pg_dump` 로는 **함께 백업되지 않는다.**
   ```bash
   docker run --rm -v policy_manager-main_api_uploads:/data -v "$PWD":/out alpine \
     tar czf /out/uploads_$(date +%F).tgz -C /data .
   ```
   (볼륨 이름은 `docker volume ls | grep api_uploads` 로 확인. 오브젝트 스토리지로 옮기면 이 단계는 사라진다 — D-06)

## 7-1. 시크릿 교체 (운영 배포 전 필수)

`docker-compose.yml`의 기본 시크릿은 **리포에 그대로 적혀 있어 공개된 값과 같다.** 운영에 그대로 올라가면 JWT 위조·DB 직접 접근이 가능하다. 그래서 `NODE_ENV=production`에서 기본값이 감지되면 **API가 기동을 거부한다**([`secrets-guard.ts`](../../../apps/api/src/common/config/secrets-guard.ts)).

### 교체 대상

| 변수 | 용도 | 조건 |
|---|---|---|
| `JWT_SECRET` | 액세스 토큰 서명 | 32자 이상, `JWT_REFRESH_SECRET`와 **다른 값** |
| `JWT_REFRESH_SECRET` | 갱신 토큰 서명 | 32자 이상 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | DB 계정 (compose가 `DATABASE_URL`을 조립) | `postgres:postgres` 금지 |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | 오브젝트 스토리지 | minio 서비스와 api가 같은 값을 공유 |

### 절차

```bash
# 1) 값 생성 (각각 따로 실행 — 같은 값 재사용 금지)
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # MINIO_SECRET_KEY

# 2) .env에 기입 (.env는 .gitignore 대상 — 커밋 금지)
cp .env.example .env && ${EDITOR:-vi} .env

# 3) 기동 전 치환 결과 확인 (실제 값이 들어갔는지, ${...}가 남지 않았는지)
docker compose config | grep -E "JWT_SECRET|POSTGRES_PASSWORD|MINIO_SECRET_KEY"

# 4) 기동 — 기본값이 남아 있으면 여기서 API가 부팅에 실패한다
docker compose up -d --build
docker compose logs api | head -30
```

### 주의

- **DB·MinIO 시크릿은 첫 기동 때 볼륨에 굳는다.** 이미 뜬 적 있는 환경에서 `POSTGRES_PASSWORD`만 바꾸면 기존 볼륨의 계정과 어긋나 접속이 실패한다. 운영 중 교체는 `ALTER USER ... PASSWORD`로 DB 안에서 바꾸고 `.env`를 맞추는 순서로 한다(볼륨 삭제 금지).
- **JWT 시크릿을 바꾸면 기존 토큰이 전부 무효**가 된다. 전 사용자 재로그인이 필요하므로 공지 후 교체한다.
- 장애 중 기동만 급히 되살려야 하면 `ALLOW_DEFAULT_SECRETS=1`로 가드를 우회할 수 있다. **우회한 기동은 그 자체로 사고 대응 대상**이며, 즉시 정상 교체 후 재기동한다.

## 7-2. 오래된 서버에 재배포 (모르는 서버 인수인계용)

2026-08-15 실측: 운영 서버는 **웹·API 모두 2026-06-15 빌드**다.
(이 저장소는 공개이므로 서버 주소는 적지 않는다 — 인프라 담당자에게 확인할 것.)
리포 최초 커밋이 6-25이므로 **git 이력에 없는 코드로 배포돼 있다.** git만 보고 서버 상태를
추정하지 말고 반드시 먼저 조사한다.

### 0단계. 조사 (읽기 전용)
```bash
ssh <서버>            # 접속 경로는 인프라 담당자에게 확인
cd <프로젝트 디렉터리>   # docker-compose.yml 이 있는 곳
sh scripts/server-recon.sh
```
이 출력으로 ① 소스 위치 ② 기본 시크릿 사용 여부 ③ DB 마이그레이션 이력 ④ 실데이터 규모가 확정된다.

### 위험 1 — 스키마 드리프트 (가장 위험)
6월 DB에는 `sections`(절, 8-02 도입)가 없는데, **baseline `00000000000000_init` 안에는 있다.**
기동 스크립트의 자동 baseline 처리는 baseline을 *실행하지 않고* "적용됨"으로 표시하므로,
그대로 두면 **`sections` 테이블이 없는 채로 적용 완료 표시**가 되어 런타임에 깨진다.

→ 자동 경로에 맡기지 말고, 배포 전에 실제 차이를 뽑아 적용한다:
```bash
# 서버 DB와 현재 스키마의 차이를 SQL로 생성 (읽기 전용, 적용 안 함)
npx prisma migrate diff   --from-url "$DATABASE_URL"   --to-schema-datamodel apps/api/prisma/schema.prisma   --script > /tmp/drift.sql
less /tmp/drift.sql       # DROP 문이 있으면 반드시 사람이 검토
```
`DROP TABLE`/`DROP COLUMN`이 보이면 **적용하지 말고** 원인을 먼저 규명한다(6월 이후 서버에서만 만들어진 것일 수 있다).

### 위험 2 — 시크릿 가드로 API 부팅 거부
재배포하면 `secrets-guard.ts`가 들어간다. 기본값(공개된 JWT 키, `minioadmin123`, `postgres:postgres`)이
남아 있으면 **운영 모드에서 API가 뜨지 않는다.** 조사 6번 항목이 0이 아니면 먼저 7-1을 수행한다.
DB·MinIO 시크릿은 볼륨에 굳어 있으므로 `.env`만 바꾸면 접속이 깨진다(7-1 주의 참고).

### 절차
```bash
# 1) 백업 (필수)
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql
ls -lh backup_$(date +%F).sql          # 0바이트가 아닌지 확인

# 2) 소스 갱신
git fetch origin && git checkout develop && git pull origin develop

# 3) 시크릿 정리 (7-1)  — 조사 6번이 0이 될 때까지
docker compose config | grep -cE 'your-super-secret|minioadmin123|postgres:postgres@'

# 4) 스키마 드리프트 해소 (위험 1)

# 5) 재배포
docker compose up -d --build
docker compose logs -f api      # 'migrate deploy completed.' 와 기동 로그 확인

# 6) 확인 — 새 엔드포인트가 401(있음)이어야 한다. 404면 옛 빌드가 그대로다
curl -s -o /dev/null -w '%{http_code}\n' "http://<호스트>/api/policies/0/as-of?date=2026-01-01"
```

### 롤백
문제 시 `git checkout <직전 커밋> && docker compose up -d --build` 후 필요하면 1)의 덤프를 복원한다.

### 별건 — 즉시 조치 권장
- `/api/docs`(Swagger)가 **인증 없이 공개**돼 있다(실측 200). 운영에서는 차단하거나 인증 뒤로 옮긴다.
- 서비스가 평문 HTTP다. 로그인 토큰이 평문으로 오간다.

## 8. 운영 체크리스트

- [ ] `.env`의 시크릿이 기본값이 아닌 운영값으로 교체되었는가 (→ 7-1. `docker compose config`로 확인)
- [ ] `ALLOW_DEFAULT_SECRETS`가 설정돼 있지 않은가
- [ ] `PUBLIC_URL`과 Google OAuth 콜백 URL이 일치하는가
- [ ] 배포 전 DB 백업(`pg_dump`)을 수행했는가
- [ ] **첨부파일 백업(`api_uploads` 볼륨)을 수행했는가** — `pg_dump` 에 포함되지 않는다
- [ ] 마이그레이션이 `migrate deploy`로 정상 적용되었는가 (기동 로그에서 `migrate deploy completed.` 확인)
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

> **2026-08-02 갱신**: 아래 블로커 4건은 모두 해소됐다. 빈 볼륨에서 `docker compose down -v && docker compose up -d --build` → 마이그레이션만으로 기동 → 로그인·규정 API·절 API·PDF 의존성 import까지 실측 확인. 아래는 당시 기록으로 남긴다.

### 발견된 빌드 블로커 (2026-07-21 기준 — 전부 2026-08-02 해소)
1. **Prisma 블록 주석**으로 `prisma generate` 실패 → 스모크 중 `///`로 수정(해결).
2. **pymupdf/pdfplumber pip 설치 실패**(Alpine musl) → 스모크에서는 해당 라인 임시 제외 후 진행. **근본 해결 필요**(미해결).
3. **apps/api 락파일 부재**로 클린 빌드가 최신 Prisma를 끌어와 1번을 표면화(미해결).
4. **baseline 마이그레이션 부재**로 `migrate deploy` 실패 → `db push --accept-data-loss` 폴백으로만 기동됨(실측 재현). 운영 데이터가 있으면 위험.

> ~~결론: 현재 클린 체크아웃에서는 위 2·3·4 때문에 본 Runbook의 배포 절차가 그대로 동작하지 않는다.~~
> **2026-08-02 해소 완료**: Debian 베이스 전환(#7), 루트 컨텍스트 + `npm ci`(#6), baseline 스쿼시(#8)로 클린 체크아웃에서 배포 절차가 그대로 동작한다.

### 마이그레이션 운영 메모 (2026-08-02~)
- 스키마 변경 시 `prisma migrate dev --name <이름>`이 정상 동작한다(baseline 확보로 섀도 DB 재생 가능). 더 이상 SQL을 손으로 쓰지 않는다.
- **baseline 이전에 만들어진 DB**는 기동 시 1회 자동 처리된다: `migrate deploy` 실패 → 기존 스키마 감지 → 옛 이력 행 정리 → baseline을 applied로 표시 → 재시도.
- 마이그레이션이 끝내 실패하면 컨테이너는 **종료**된다. 예전처럼 `db push`로 넘어가 데이터를 덮어쓰지 않는다.

### 환경 주의: 호스트 80 포트 충돌
검증 머신에 로컬 Kubernetes(ingress-nginx)가 호스트 `:80`을 점유하고 있어 web 컨테이너가 `:80`으로 게시되지 않았다(컨테이너는 정상, 호스트 노출만 실패). 동일 상황에서는 `docker-compose.yml`의 web 포트를 `"8080:80"` 등으로 바꾸거나 점유 프로세스를 내리고 기동할 것.

## 10. 향후 개선 (참고)

무중단 배포, 이미지 태그 기반 롤백, 마이그레이션 down 전략, 자동 백업 스케줄은 현재 미비. [02_WBS_작업분해](../02_WBS_작업분해/WBS_작업분해.md) WP2 참고.
