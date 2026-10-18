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

- `PUBLIC_URL` — 사용자가 브라우저에 입력하는 실제 URL (예: `https://your-domain.com`). CORS에 사용됨
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
5. **재파싱 묶음(632466a, T-110 ②) 이전 코드로 되돌릴 때 (T-131)** — 옛 코드는 묶음 초안(`reparse_item_id`)을 일반 초안으로 보고 하나씩 승인할 수 있어 **묶음 일부만 발행**되고, 버전별 계층(`structure`)을 무시해 그 전 날짜의 시점 조회가 지금 계층으로 나온다. 순서대로:
   1. 쓰기를 막는다(점검 공지 후 웹을 내리거나 관리자 외 접속 차단) — 진행 중인 요청이 끝날 때까지 기다린다
   2. **지금 코드로** 반영·검토 중인 재파싱 묶음을 모두 반려한다(재파싱 검토 화면 `묶음 반려`)
   3. 읽기 전용으로 확인한다(7-6 방식) — 둘 다 0 이어야 한다:
      `SELECT count(*) FROM reparse_reviews WHERE status IN ('applied','submitted');` · `SELECT count(*) FROM article_versions WHERE reparse_item_id IS NOT NULL AND status IN ('draft','review');`
   4. 이미 승인한 묶음이 있으면(`SELECT count(*) FROM article_versions WHERE structure IS NOT NULL;` 가 0 이 아니면) **632466a 이전으로는 되돌리지 않는다** — 반려로 풀리지 않는다. 그 기록을 읽는 632466a 이후 릴리스까지만 되돌린다
   5. 이미지를 바꿔 기동이 끝날 때까지 1의 쓰기 차단을 유지한다
   6. 이미 그렇게 되돌렸다가 다시 올렸다면: 발행 이력에 남은 제안 계층을 지우고(`UPDATE article_versions SET structure = NULL WHERE status IN ('published','archived') AND structure->>'kind' = 'proposal';`) 반영·검토 중으로 멈춘 묶음을 지금 코드로 반려한다
4. **첨부파일 백업**: 규정 첨부는 DB가 아니라 `api_uploads` 볼륨에만 있어 `pg_dump` 에 **포함되지 않는다.** 아래 8절의 서버 밖 백업이 DB와 첨부를 함께 내보내므로, 그것이 돌고 있으면 이 항목은 자동으로 충족된다.

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

## 7-3. 서버 밖 백업 (필수)

### 왜 필요한가

**규정 본문(DB)과 첨부파일이 둘 다 이 서버 안에만 있다.** 기존 절차의
`pg_dump > backup_YYYYMMDD.sql` 은 같은 서버에 파일을 만드는 것이라,
배포하다 잘못됐을 때 되돌리는 용도는 되지만 **서버 자체가 사라지면 백업도
함께 사라진다.** Always Free 인스턴스는 유휴 상태가 이어지면 회수되기도 한다.

첨부파일은 DB 백업에 들어 있지도 않았다. 둘 다 내보내야 복구가 성립한다.

### 설정

S3 호환 저장소면 어디든 된다(Oracle Object Storage, AWS S3, 별도 서버의 MinIO).
`.env` 에 아래를 채운다 — 값은 인프라 담당자가 발급한다.

```
BACKUP_S3_ENDPOINT=https://<네임스페이스>.compat.objectstorage.<리전>.oraclecloud.com
BACKUP_S3_BUCKET=policy-manager-backup
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
BACKUP_KEEP_DAYS=30
```

> Oracle Object Storage 를 쓴다면 콘솔에서 **Customer Secret Key** 를 발급받아
> 위 두 값에 넣는다(사용자 API 키와 다르다). 엔드포인트는 버킷의
> "S3 호환성" 안내에 표시된다.

### 매일 자동 실행

```bash
crontab -e
# 매일 새벽 3시. 실패하면 종료 코드가 0이 아니라 cron 이 메일로 알린다.
0 3 * * * cd /home/ubuntu/policy_manager && bash scripts/backup-offsite.sh >> /var/log/policy-backup.log 2>&1
```

한 번 손으로 돌려 확인:

```bash
bash scripts/backup-offsite.sh
```

DB 덤프 → 첨부 아카이브 → 업로드 → **업로드된 크기 대조** → 오래된 것 정리
순으로 진행하고, 어디서든 어긋나면 종료 코드 1로 멈춘다. 0바이트 덤프를
성공으로 넘기지 않는다.

### 복원되는지 확인 (한 달에 한 번은 돌릴 것)

**복원해 본 적 없는 백업은 백업이 아니라 희망이다.**

```bash
bash scripts/restore-offsite.sh --verify
```

최신 백업을 내려받아 **임시 DB에 넣어 보고** 원본과 테이블·행 수를 대조한 뒤
임시 DB를 지운다. 운영 데이터는 건드리지 않는다. 첨부 아카이브도 열어 본다.

### 실제 복구

```bash
bash scripts/restore-offsite.sh --restore 2026-09-07T030000Z
```

파괴적이다. `RESTORE` 를 직접 입력해야 진행되며, api·web 을 멈추고 DB와 첨부
볼륨을 덮어쓴 뒤 다시 띄운다. 백업 목록은 `--verify` 실행 로그나 저장소 콘솔에서 확인한다.

### 한계

- 하루 한 번이므로 **최대 24시간치를 잃을 수 있다.** 더 촘촘히 하려면 주기를 줄인다.
- 첨부 아카이브는 스택이 도는 중에 만들므로, 그 순간 업로드 중이던 파일 하나가
  빠질 수 있다. 다음 회차에 포함된다.
- 저장소 자격증명이 서버 `.env` 에 있다. 서버가 털리면 백업도 지워질 수 있다 —
  저장소 쪽에서 **버전 관리나 삭제 보호**를 켜 두는 것이 안전하다.

---

## 7-4. 비밀번호 재설정 (서버에서)

화면에서는 ① 본인이 `내 정보 > 비밀번호 변경`, ② 관리자가 구성원 행의 `비밀번호 재설정` 으로 바꾼다.
이메일 발송이 없어 "비밀번호 찾기"는 없다. **조직의 마지막 관리자가 비밀번호를 잊으면** 화면으로는 불가능하므로 서버에서:

```bash
bash scripts/oracle/reset-password.sh <조직코드> <이메일>
```

비밀번호는 두 번 입력받으며 화면·셸 기록에 남지 않는다. 해당 사용자의 모든 세션이 끊기고, 감사 로그에 `user.password_reset`(`via: server-script`)이 남는다. **다음 로그인 때 본인이 비밀번호를 바꾸게 된다**(T-122 — 다른 사람이 정한 비밀번호이므로).

## 7-5. 법령 동기화 (매일, T-104)

등록된 법령에 새 판이 났는지 법제처에서 확인한다. 서버 crontab 에 한 줄:

```bash
30 4 * * * cd ~/policy_manager && bash scripts/oracle/law-sync.sh >> ~/law-sync.log 2>&1
```

- 확인이 오래된 법령부터 20건(`--limit 50` 처럼 늘릴 수 있다). 하나라도 실패하면 **종료 코드 1** — 로그의 `실패:` 줄에 법령과 사유가 남는다.
- **법제처 인증값(`LAW_GO_KR_OC`)이 필요하다.** 법제처가 서버 IP·도메인을 이유로 거절할 수도 있는데(지금 운영 서버는 IP 등록 없이 통과한다), 이 거절도 HTTP 200 으로 와서 조용히 넘어가기 쉽다 — 그래서 실패를 따로 기록한다. 실패하면 법령 목록에 `확인 실패` 가 뜬다.
- 결과는 통합 관리자 콘솔의 `법령 동기화` 패널에서도 보이고, 거기서 바로 실행할 수도 있다(플랫폼 관리자).
- 실행 중 서버가 재시작돼 `진행 중` 으로 남은 기록은 30분 뒤 다음 실행이 "중단됨"으로 닫는다.
- **T-151 부터 두 확인 사이에 공포된 판을 공포 순으로 하나씩 반영한다**(시행 예정 판 포함). 법령당 한 번에 5판(`LAW_SYNC_MAX_VERSIONS`), 실행 전체 20분(`LAW_SYNC_BUDGET_MS`)까지 — 남은 판은 다음 실행이 잇는다. 어느 판에서 실패하면 앞 판까지 반영하고 멈추며 로그의 `실패:` 줄에 판(MST)과 사유가 남는다.
- **T-151 운영 반영 절차** — 첫 동기화가 저장 판 뒤의 판을 한꺼번에 이벤트·개정 후보로 만든다(되돌리기 어렵다). 아래를 마칠 때까지 crontab 의 law-sync 줄을 주석 처리해 두고, 통합 관리자 콘솔의 "지금 확인" 도 누르지 않는다(같은 첫 반영이 돈다).
  1. **배포 전**(Mac, 7-6 방식 — 읽기 전용이고 새 표를 쓰지 않는다): `ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/t151-law-id-check.sql` — ① 법령ID 없는 행(동기화되지 않는다) ② 같은 법령ID 의 중복 행. 0건이었어도 **배포 직후 한 번 더** 돌린다(그 사이 옛 코드가 MST 로만 찾아 행을 더 만들 수 있다). 둘 다 0건이면 3 으로.
  2. 0건이 아니면 **배포 직후 바로**(그 사이 고객 등록이 법령ID 없는 행 옆에 둘째 행을 만들 수 있다). **해제·삭제부터 하지 않는다**(연결·변경 이력이 지워진다).
     - ① 의 행이고 `같은_이름_다른_행` 이 0 이며 ② 에 같은 법령명이 없으면: 그 행의 **같은 판(저장 MST)을 다시 등록**한다. 등록 화면은 현행 판만 보여 주므로 API 로(회사 관리자 역할이 있는 계정, 서비스 주소는 저장소에 적지 않는다): `curl -s https://<서비스 주소>/api/auth/login -H "Content-Type: application/json" -d '{"email":"<관리자>","password":"<비밀번호>","tenantSlug":"<회사>"}'` 의 `accessToken` 으로 `curl -s https://<서비스 주소>/api/laws -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" -d '{"mst":"<저장 MST>"}'`. 응답의 `externalLawId` 가 채워지고 `alreadyTracked` 가 false 여야 한다(409 "옛 중복" 이면 아래 T-154). 저장 공포일이 늦은 행부터 하고, 마친 뒤 1 의 SQL 을 다시 돌려 그 행이 빠졌는지, `--plan --law <법령 id>` 로 반영할 판을 본다.
     - 그 밖(`같은_이름_다른_행` 1 이상, ② 에 같은 법령명, 다시 등록 응답이 409 "옛 중복", 서버 로그 "법령 행이 N개입니다", 동기화 확인 실패 "같은 법령이 따로 등록돼 있어", 이름이 바뀐 것으로 의심되는 법령)은 옛 중복이다 — 다시 등록하지 말고 T-154 로 넘긴다(연결을 한 행으로 모으고 나머지를 지운다).
  3. 반영될 판을 미리 본다(DB 에는 쓰지 않는다 — 법제처 응답 캐시만 쓴다): 서버에서 `cd ~/policy_manager && bash scripts/oracle/law-sync.sh --plan` — 법령마다 저장 판·현행 판·반영할 판(공포번호·제개정구분·단계 시행일)이 찍힌다. 한 번에 확인이 오래된 100개까지 보고, 더 있으면 요약에 전체 수가 찍힌다(각 줄의 `[법령 id]`, 나머지는 법령 화면 주소의 id 로 `--law <법령 id>`). 판이 많거나 시행일이 한참 지난 판이 보이면 첫 반영의 후보·알림 처리(D-18 ②)를 먼저 정한다.
  4. **진행 기준**: D-18 ①·② 가 정해졌고 1~3 을 마쳤으면 crontab 줄을 되살린다. 남은 옛 중복·법령ID 없는 행은 그 법령만 확인 실패로 남고(고객 화면에는 "아스트룸에 문의", 법령ID 없는 행은 통합 관리자 화면 동기화 이력에 운영자 안내가 함께 뜬다) 다른 법령은 정상으로 돈다. 옛 중복인 법령은 정리(T-154) 전까지 새 등록도 409 다.

## 7-6. 운영 DB 읽기 전용 점검 (Mac에서, T-121)

데이터를 고치지 않고 **건수만** 보는 점검 SQL은 `scripts/oracle/sql/` 에 둔다. Mac 에서:

```bash
ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/<파일>.sql
```

- 서버 주소는 저장소에 적지 않는다(공개 저장소). 실행할 때 넘긴다. 키는 기본 `~/.ssh/veda_oci`(`ORACLE_SSH_KEY` 로 바꿀 수 있다).
- 읽기 전용은 두 겹이다: SQL 파일이 `BEGIN TRANSACTION READ ONLY` … `ROLLBACK` 으로 감싸고, 접속도 `default_transaction_read_only=on` 으로 연다. 쓰기 문이 섞여 있으면 DB가 거절한다.
- 점검 SQL은 규정 **본문을 출력하지 않는다**(회사·규정 코드·이름·날짜·건수만).

| 파일 | 보는 것 |
|---|---|
| `t121-pdf-import-check.sql` | PDF로 가져와 등록한 규정마다: 수정 전 등록인지, **첫 줄이 빠진 항·호·목 수**(가져올 때의 원본 트리로 센다), **조 번호가 한 칸 밀렸는지**(가짜 "머리말" 조), 본문이 빈 항·목 행 수 (C-44) |
| `draft-only-articles.sql` | 규정마다 **시행 전 초안만 있는 조문 수**와 그중 내용이 있는 초안 수 — "한꺼번에 시행하기"로 시행될 조문 (C-46) |
| `t128-version-duplicates.sql` | 같은 조문에 **같은 버전 번호가 겹친 곳**(회사·규정 코드·조·항·호·번호·건수, 본문 없음). 0건이면 T-128 마이그레이션은 유니크만 건다. 있으면 그 조문들만 버전 번호를 지금 순서대로 다시 매긴다 — 배포를 막는 점검은 아니고 미리 보기용 (T-128) |
| `t146-ai-qa-check.sql` | 규정 질문 — **켜진 회사**(코드·이름·동의한 고지 판·동의 시각·최근 하루 AI 가 답한 질문 수)와 켜진 회사 수(T-146 배포 직후 0), **AI 를 부른 질문**(회사별·전체 기간 — 운영 키 전에는 비어 있어야 한다), **가장 오래된 질문 기록**의 날짜·지난 일수(90 을 넘으면 파기 cron 확인). 질문·답 내용은 출력하지 않는다 (T-146) |
| `t151-law-id-check.sql` | 법령 판 차례 반영(T-151) 반영 전 — **법령ID 없는 법령 행**(법령명·저장 MST·연결·개정후보 수·같은 이름의 다른 행 수)과 **같은 법령ID 의 중복 행**(법령ID·법령명·행 수·저장 MST들). 둘 다 0건이어야 한다(처리 순서는 7-5) |

## 7-7. 고객사 개설과 첫 플랫폼 관리자 (T-122)

**운영은 공개 회원가입이 닫혀 있다** — Oracle compose 가 `ALLOW_PUBLIC_SIGNUP` 을 넘기지 않으므로 기본값(닫힘)이다. 고객사는 아스트룸이 연다.

- **평소**: 통합 관리자 콘솔 › **고객사 개설**(회사명·기관 코드·플랜·마스터 이메일·이름). 임시 비밀번호가 **한 번만** 나온다 — "전달용 내용 복사"로 마스터에게 전달한다. 마스터는 처음 로그인할 때 비밀번호를 바꾸고, 직원 계정은 마스터가 설정 › 팀원 초대에서 발급한다(직원도 첫 로그인 때 바꾼다).
- **새 서버의 첫 플랫폼 관리자**(화면으로는 만들 수 없다):

```bash
bash scripts/oracle/create-tenant.sh astrum "아스트룸" 운영자이메일 "운영자 이름" --platform-admin
```

  임시 비밀번호는 이 출력에만 나온다. 기관 코드 `astrum` 으로 로그인해 바로 바꾼다.
- **데모 데이터를 넣은 적 있는 서버**: 시드가 만든 `admin@astrum.com`(비밀번호가 공개 저장소에 적혀 있다)이 플랫폼 관리자로 남아 있다. 실제 운영자를 플랫폼 관리자로 지정한 뒤 이 계정의 플랫폼 관리자 권한을 해제하고 비밀번호도 바꾼다(7-4).
- 요청 횟수 제한은 IP 당·경로별 분당 100(`THROTTLE_LIMIT`, 운영 기본값). 개발·CI 의 docker-compose 만 1000 으로 올린다 — 통합 테스트가 한 IP 에서 수백 번 로그인한다.
- **로그인 세션(T-137)**: 배포 직후에도 이미 로그인한 사람은 튕기지 않는다 — 옛 갱신 토큰은 다음 갱신 때 한 번만 기기 세션으로 옮겨진다. 세션 수명은 `AUTH_REMEMBER_TTL`(자동 로그인, 기본 30d)·`AUTH_SESSION_TTL`(기본 12h). 특정 사람을 모든 기기에서 내보내려면 관리자가 비밀번호를 재설정한다
- **요금제 변경은 통합 관리 › 테넌트 플랜에서 플랫폼 관리자가 한다**(가격 확정 전 임시 운영 방침, T-125 · [ADR-0022](../10_ADR_의사결정기록/ADR.md)). 운영은 **결제 미사용**이다 — Oracle compose 가 `PAYMENT_PROVIDER` 를 넘기지 않으므로 고객사의 결제 시작은 403, 결제 웹훅도 받지 않는다. 운영에 `PAYMENT_PROVIDER=mock` 을 넣지 않는다(돈을 받지 않고 요금제를 올린다). 확인: `curl -s -X POST https://<도메인>/api/billing/webhook -H 'Content-Type: application/json' -d '{"type":"ping"}'` 가 403 `PAYMENT_DISABLED` 면 정상(데이터는 바뀌지 않는다)

## 7-8. 지운 파일은 서버에서 따로 지운다

`package.py` 묶음을 기존 `~/policy_manager` 위에 풀기 때문에, **저장소에서 지운 파일이 서버에는 남는다.** 남은 소스는 이미지 빌드에 그대로 들어가므로, 지운 의존성을 불러오는 파일이 남으면 빌드가 깨진다(2026-10-11 배포 때 구글 로그인 파일로 실제로 발생할 뻔했다).

배포마다 풀기 전에 서버 소스 목록과 묶음 목록을 비교해, 묶음에 없는 파일만 지운다(읽기 전용 목록 → 확인 → 삭제).

```bash
ssh <서버> "cd ~/policy_manager && find apps scripts -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/uploads/*' | sort" > server-files.txt
python3 - <묶음.tar.gz> server-files.txt <<'PY'
import tarfile, sys
pkg = {m.name.split('/', 1)[1] for m in tarfile.open(sys.argv[1]).getmembers() if m.isfile()}
print('\n'.join(f for f in map(str.strip, open(sys.argv[2])) if f and f not in pkg))
PY
```

## 7-9. 규정 질문(AI) — 키를 넣기 전 순서와 질문 기록 파기 (T-146)

규정 질문은 질문할 때 질문·회사 규정의 조 목차·관련 조문을 Anthropic(미국)으로 보낸다. 고객사 동의 없이 외부로 나가는 일이 없게, **운영 AI 키(`ANTHROPIC_API_KEY`)는 아래 순서를 마친 뒤에 넣는다**(D-09 재결정 2026-10-14, ADR-0025).

명령은 서버의 `~/policy_manager` 에서 실행한다. 운영은 `scripts/oracle/compose.sh`(`.env.oracle`·`docker-compose.oracle.yml`)로만 돈다 — 개발용 `.env` 와 맨 `docker compose` 를 쓰지 않는다. 점검 SQL `scripts/oracle/sql/t146-ai-qa-check.sql` 은 7-6 방식(Mac)으로 돌린다. 키 값은 화면·로그·대화에 찍지 않는다.

1. 운영 키가 들어갈 길을 막고 T-146 을 배포한 뒤, 이미 외부로 나간 것이 없는지 본다(키 값은 찍지 않는다).
   - 배포 전: env 파일 `grep -cE '^[[:space:]]*(export[[:space:]]+)?ANTHROPIC_API_KEY[[:space:]]*[=:][[:space:]]*[^[:space:]#]' .env.oracle` 이 0 이어야 한다(빈 따옴표 `=""` 도 1 로 센다 — 그 줄은 `ANTHROPIC_API_KEY=` 로 둔다). 서버 셸 `[ -z "${ANTHROPIC_API_KEY:-}" ] && echo 비어 있음 || echo 들어 있음` 은 "비어 있음"이어야 한다. 아니면 env 파일은 편집기로 비우고, 셸은 `unset ANTHROPIC_API_KEY` 한 뒤 로그인 스크립트(`~/.bashrc`·`~/.profile` 등)의 export 줄도 지운다 — 배포가 API 를 다시 만들 때 이 값들이 들어간다.
   - T-146 을 배포하고, 배포된 컨테이너에 키가 없는지 본다: `bash scripts/oracle/compose.sh exec -T api sh -c '[ -z "$ANTHROPIC_API_KEY" ] && echo 비어 있음 || echo 들어 있음'`(들어 있으면 위처럼 비우고 4단계 2번 명령으로 다시 만든다). 마이그레이션 `20261014090000_ai_qa_consent` 적용도 확인한다 — 점검 SQL 의 켜진 회사 수가 0 이어야 한다. 점검 SQL 은 이 마이그레이션의 칸을 읽으므로 배포 뒤에만 돈다.
   - 같은 점검 SQL 의 "AI 를 부른 질문" 목록이 비어 있어야 한다(마이그레이션은 질문 기록을 건드리지 않는다). 있으면 동의 절차 없이(T-130 은 기본 켜짐) 이미 외부로 나간 것이니 사고로 다룬다 — 2단계(파기 cron)로 가지 말고 PM 에 알려 회사별 건수를 남긴 뒤 판단을 기다린다.
2. 질문 기록 파기 cron 을 걸고(아래) 한 번 직접 돌려 본다: `bash scripts/oracle/ai-qa-purge.sh; echo $?` → `[ai-qa-purge] 90일 지난 기록 N건 삭제` 줄과 0.
3. 선행 작업을 끝낸다. 대장 T-157 은 개발 환경 확인(구조화 출력·대체 모델·캐싱·처리 지역)까지만 여기의 선행 조건이다 — 운영 키는 4단계 2번에서만 넣고, T-157 의 운영 확인은 4단계가 대신한다. 그리고 T-171(백업 보관 기간을 정해 고지 문구·판 올림을 운영에 배포하고, 처리방침 보관 기간 항목에도 적는다), 처리방침의 국외 이전 항목 공개, 쓰려는 고객사와 개인정보 처리위탁 계약(재위탁·국외 이전 동의 — `19_법무문서`, 변호사 검토 뒤). 4·5단계의 동의는 T-171 이 반영된 고지로 받는다.
4. 운영 키를 넣고 실제 호출을 한 번 확인한다. 키는 넣는 즉시 모든 회사에 적용되므로(메뉴가 보이고 관리자가 켤 수 있다) 사용이 적은 시간에 하되, cron(04:10 파기·04:30 법령 동기화)과 겹치는 04:00~05:00 은 피한다.
   1. 키를 넣기 전에 운영에 배포된 고지의 보관 기간을 찍어 본다: `bash scripts/oracle/compose.sh exec -T api node -e "console.log(require('./dist/ask/ask-notice').aiQaNotice().retention.join('\n'))"`. 백업 일수가 T-171 에서 정하고 처리방침에 적은 일수와 같아야 한다 — 다르거나 숫자가 없으면 키를 넣지 않고 3단계로 돌아간다. 점검 SQL 도 한 번 돌려 켜진 회사 목록을 적어 둔다(되돌릴 때의 기준).
   2. `.env.oracle` 을 편집기로 열어 `ANTHROPIC_API_KEY=` 에 키를 넣는다(줄이 없으면 더한다. 셸 기록에 남지 않게 `echo` 로 쓰지 않는다). `bash scripts/oracle/compose.sh up -d --wait --force-recreate api web` 로 API·웹 컨테이너를 다시 만든다 — 환경변수는 다시 만들어야 들어가고(`restart` 로는 안 된다), 웹(nginx)은 기동할 때 API 주소를 한 번만 찾으므로 함께 다시 만든다. 명령이 끝나면 웹을 거친 `/api/health` 까지 상태 확인을 통과한 것이다.
   3. 아스트룸 자체 시험 회사(고객 데이터가 없는 회사 — 없으면 통합 관리자 화면에서 만든다)의 관리자로 로그인해 **규정을 하나 만들고 지난 날짜를 시행일로 발행한다**. 규정 질문 화면에서 "회사 전체 켜기"로 고지를 확인하고 켠 뒤 그 규정 내용을 묻는다.
   4. 점검 SQL 에서 시험 회사의 `최근_하루_답한_질문` 이 1 이상이어야 AI 가 실제로 답한 것이다(화면 문구만으로는 가리지 못한다 — 시행 중인 규정이 없거나 고르기 전에 끝나면 AI 를 부르지 않는다). 그리고 `bash scripts/oracle/compose.sh logs api` 에서 기동 줄(`Application is running on port`) 뒤로 `AI 처리 지역이 us 가 아님` 경고가 없어야 한다(응답의 처리 지역이 us 가 아니거나 응답에 지역이 없어도 이 경고가 남는다).
   5. **2~4번 가운데 하나라도 어긋나면 5단계로 가지 않고 되돌린다.** 먼저 로그를 저장한다(다시 만들면 옛 컨테이너 로그가 사라진다): `bash scripts/oracle/compose.sh logs --no-color api > ~/ai-qa-check-$(date +%Y%m%d%H%M).log`. 시험 회사를 끄고, `.env.oracle` 의 키를 빈 값으로 되돌려 2번 명령으로 다시 만든 뒤 규정 질문 메뉴가 사라졌는지(직접 들어가면 "규정 질문(AI)은 아직 준비 중입니다") 본다(열어 둔 탭은 새로고침한 뒤). 1단계의 컨테이너 확인 명령으로 "비어 있음"도 본다. 점검 SQL 의 켜진 회사 목록을 1번에서 적어 둔 것과 견줘, 그사이 켠 회사가 있으면 그 회사에 알린다. 그다음 저장한 로그로 원인을 확인하고, 확인이 끝나면 그 로그 파일을 지운다.
   6. 모두 맞으면, 시험 회사는 계속 쓸 게 아니면 끈다.
5. 고객사 관리자가 규정 질문 화면에서 고지를 확인하고 켠다. 아스트룸이 대신 켜는 길은 없다(동의는 고객사 몫).

질문 기록 파기 — 서버 crontab 에 한 줄(법령 동기화 04:30 과 겹치지 않게):

```bash
10 4 * * * cd ~/policy_manager && bash scripts/oracle/ai-qa-purge.sh >> ~/ai-qa-purge.log 2>&1
```

- 90일(코드 상수 `AI_QA_LOG_RETENTION_DAYS`)보다 오래된 질문·답 기록을 모든 회사에서 지운다. 로그에는 지운 건수만 남고 질문 내용은 남지 않는다. 실패하면 종료 코드 1.
- **파기가 실제로 도는지 주 1회 확인한다**(cron 이 빠지면 고지의 "90일 보관한 뒤 지웁니다"가 거짓이 된다): `tail ~/ai-qa-purge.log` 와 점검 SQL — 가장 오래된 기록의 지난 일수가 90 을 넘으면 cron 을 확인한다(하루 한 번, 정확히 90일 기준으로 지우므로 정상이면 지난 일수 — 하루 미만은 버린 값 — 가 90 을 넘지 않는다).
- 보관 일수는 관리자가 동의한 고지에 실린다 — 바꾸려면 코드에서 바꾸고 `apps/api/src/ask/ask-notice.ts` 의 고지 판(`AI_QA_NOTICE_VERSION`)을 올려 배포한다(고지 지문 시험이 잡는다). 판을 올리면 모든 회사가 관리자가 다시 확인할 때까지 꺼진다.
- **백업에는 파기 전 기록이 남는다.** 고지는 "장애 복구용 백업에는 백업 보관 기간 동안 남습니다"라고만 적는다. 지금 배포 전 로컬 덤프(`backups/oracle/*`)는 자동으로 지워지지 않고, 서버 밖 백업 보관 기간도 7-3(30일)과 `backup-oci.py`(14일)가 다르다 — 대장 T-171(백업 보관 기간 정리)을 끝내 운영에 배포하고 처리방침에 적기 전에는 운영 AI 키를 넣지 않는다(3단계).

## 8. 운영 체크리스트

- [ ] `.env`의 시크릿이 기본값이 아닌 운영값으로 교체되었는가 (→ 7-1. `docker compose config`로 확인)
- [ ] `ALLOW_DEFAULT_SECRETS`가 설정돼 있지 않은가
- [ ] 배포 전 DB 백업(`pg_dump`)을 수행했는가 — 되돌리기용 스냅샷
- [ ] **서버 밖 백업(7-3절)이 어젯밤 정상 실행됐는가** — `tail /var/log/policy-backup.log`. DB·첨부를 함께 내보내는 것은 이쪽뿐이다
- [ ] (월 1회) `restore-offsite.sh --verify` 로 **복원되는지** 확인했는가
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

무중단 배포, 이미지 태그 기반 롤백, 마이그레이션 down 전략은 현재 미비. ~~자동 백업 스케줄~~ 은 **2026-09-07 해소**(7-3절). [02_WBS_작업분해](../02_WBS_작업분해/WBS_작업분해.md) WP2 참고.
