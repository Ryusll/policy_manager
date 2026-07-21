# ADR (아키텍처 의사결정 기록)

작성일: 2026-07-21

이 문서는 policy_manager 코드베이스에 **이미 반영되어 있는** 주요 설계 결정을, 코드를 근거로 사후 기록(retroactive ADR)한 것이다. 결정의 "왜"는 코드만 봐서는 유실되므로 여기 남긴다. 앞으로의 결정은 새 번호(ADR-0009…)로 이어서 추가하고, 뒤집힌 결정은 상태를 `Superseded by ADR-XXXX`로 바꾼다.

> 참고 사료: `docs/v1.md`~`v3.md`(변경 이력, changelog 성격), `docs/policy_manager_개발정의서.docx`, `docs/VEDA_FeatureList.docx`.

## 목록
| # | 제목 | 상태 |
|---|------|------|
| ADR-0001 | 조·항·목을 단일 Article 테이블 + nullable 번호로 표현 | Accepted |
| ADR-0002 | 멀티테넌시를 공유 DB + tenantId 컬럼(앱 레벨 격리)로 구현 | Accepted |
| ADR-0003 | 테넌트 브랜딩을 서버가 아닌 브라우저 localStorage에 저장 | Accepted (제한 있음) |
| ADR-0004 | 결제를 provider 추상화로 두되 결제 이력 테이블은 미사용 | Accepted (미완성) |
| ADR-0005 | 컨테이너 기동 시 migrate 실패하면 db push로 폴백 | Accepted (기술부채) |
| ADR-0006 | 검색을 pg_bigm 우선 + ILIKE 폴백으로 구현 | Accepted |
| ADR-0007 | JWT를 Authorization 헤더로, CORS는 origin reflect | Accepted |
| ADR-0008 | PDF 텍스트 추출을 런타임 Python 서브프로세스로 수행 | Accepted |

---

## ADR-0001 — 조·항·목을 단일 Article 테이블 + nullable 번호로 표현

**상태**: Accepted

**맥락**
법령정보센터 방식의 조(條)·항(項)·목(目) 3계층을 표현해야 한다. 계층마다 별도 테이블(Article/Clause/Item)로 나누는 방식과, 한 테이블에서 번호 컬럼으로 계층을 구분하는 방식이 있다.

**결정**
`Article` 단일 테이블에 `number`(조), `clauseNumber`(항, nullable), `itemNumber`(목, nullable)를 두고 행 유형을 번호 null 여부로 판별한다. 조 루트=`clauseNumber·itemNumber` 둘 다 null, 항=`clauseNumber`만 있음, 목=`itemNumber` 있음. (근거: `apps/api/prisma/schema.prisma`의 Article, `apps/web/src/lib/articleStructure.ts`, `legalArticleLabel.ts`)

**결과**
- (+) 조인 없이 한 테이블 정렬(`number → clauseNumber → itemNumber`)로 전체 트리를 구성. 스키마가 단순하고 마이그레이션 부담이 적다.
- (+) "1항에 잘못 들어간 제목을 조 제목으로 승격" 같은 구조 편집이 번호만 바꾸면 되는 단순 연산이 된다.
- (−) 행 유형 판별 로직이 DB가 아닌 애플리케이션 코드에 흩어진다(`articleStructure.ts` 등). DB 제약으로 무결성을 강제하기 어렵다.
- (−) 가져오기 시 항·목 자동 매핑이 안 되어 수동 구조 편집이 필요하다(알려진 제한, SRS 13.4).

---

## ADR-0002 — 멀티테넌시를 공유 DB + tenantId 컬럼(앱 레벨 격리)로 구현

**상태**: Accepted

**맥락**
여러 고객사(테넌트)가 한 인스턴스를 공유하는 SaaS다. 테넌트별 DB/스키마 분리, PostgreSQL Row-Level Security(RLS), 공유 테이블+`tenantId` 컬럼 중 선택이 필요했다.

**결정**
모든 핵심 테이블에 `tenantId` FK를 두고 애플리케이션 코드(서비스 계층)가 매 쿼리에 `tenantId` 필터를 건다. RLS는 사용하지 않는다. (근거: `schema.prisma` 전 모델의 `tenantId`, 각 `*.service.ts`의 `where: { tenantId }` 패턴, `common/guards`)

**결과**
- (+) 단일 DB로 운영·마이그레이션·백업이 단순하다. 소규모 팀에 적합.
- (+) 테넌트 간 통계·통합 관리(global_admin)가 쉽다.
- (−) **격리가 코드 규율에 의존한다.** 어느 한 쿼리라도 `tenantId` 필터를 빠뜨리면 테넌트 간 데이터 노출이 발생한다(보안 검토 대상, [15_보안검토서](../15_보안검토서/보안_검토서.md)). 404로 위장되지만 근본 방어는 아니다.
- (−) 데이터 급증 시 테넌트별 분리/샤딩으로 전환하려면 대규모 마이그레이션이 필요하다.

---

## ADR-0003 — 테넌트 브랜딩을 서버가 아닌 브라우저 localStorage에 저장

**상태**: Accepted (제한 있음)

**맥락**
고객사 로고·브랜드 마크·테마 색을 저장해야 한다. 플랫폼(운영사) 브랜딩은 서버(`PlatformBranding` 테이블)에 두기로 이미 결정됨.

**결정**
테넌트 브랜딩은 서버에 저장하지 않고 브라우저 localStorage에 Zustand persist(`veda-brand`)로 저장한다. (근거: `apps/web/src/stores/brandStore.ts`의 `persist(..., { name: 'veda-brand' })`) 플랫폼 브랜딩만 서버 API(`/platform-branding`)로 관리한다.

**결과**
- (+) 브랜딩 CRUD를 위한 백엔드 API·테이블·업로드 스토리지가 필요 없어 구현이 빠르다.
- (−) **기기/브라우저를 바꾸면 브랜딩이 유실된다.** 팀원 간 공유도 안 된다(각자 로컬에만 존재). SRS BRAND-2에 제한사항으로 명시.
- (−) 로고 이미지가 data URL로 localStorage에 들어가 용량 한계가 있다.
- 향후 서버 동기화가 필요하면 별도 결정(ADR)으로 이 결정을 대체한다.

---

## ADR-0004 — 결제를 provider 추상화로 두되 결제 이력 테이블은 미사용

**상태**: Accepted (미완성)

**맥락**
플랜 업그레이드(Pro/Enterprise) 결제가 필요하나, 초기에는 특정 PG사 연동 없이 데모/개발이 가능해야 한다.

**결정**
`PAYMENT_PROVIDER` 환경변수로 분기한다. `mock`(기본)은 즉시 플랜을 올리고, 그 외 값은 `PAYMENT_HOSTED_CHECKOUT_URL`로 리다이렉트한 뒤 웹훅(`payment.succeeded`, 시크릿 검증)으로 반영한다. 결제 처리 결과는 `tenant.plan` 갱신 + 감사 로그만 남긴다. (근거: `apps/api/src/billing/billing.service.ts`)

**결과**
- (+) PG 없이도 전체 업그레이드 플로우를 데모할 수 있고, 나중에 웹훅만 실제 PG에 물리면 된다.
- (−) 스키마에 있는 `BillingCustomer`/`BillingSubscription`/`BillingPayment` 테이블을 **전혀 쓰지 않는다.** 결제·구독 이력이 남지 않는다(SRS 13.1, [08_ERD](../08_ERD_테이블명세서/ERD_테이블명세서.md)의 주의 참고).
- (−) 특정 PG SDK·영수증·환불 처리가 없다. 실서비스 결제 전 별도 구현 필요.

---

## ADR-0005 — 컨테이너 기동 시 migrate 실패하면 db push로 폴백

**상태**: Accepted (기술부채)

**맥락**
API 컨테이너 기동 시 DB 스키마를 자동으로 최신화해야 한다. Prisma에는 `migrate deploy`(이력 기반)와 `db push`(스키마 강제 반영)가 있다.

**결정**
`docker-entrypoint.sh`에서 `prisma migrate deploy`를 먼저 시도하고, 실패하면 `prisma db push --accept-data-loss`로 폴백한 뒤 데모 시드를 실행한다. (근거: `apps/api/docker-entrypoint.sh`)

**결과**
- (+) 마이그레이션 이력이 깨져도 컨테이너가 뜬다(개발/데모 편의).
- (−) **`--accept-data-loss` 폴백은 운영 데이터 손실 위험이 있다.** 초기 스키마를 만드는 baseline 마이그레이션이 없어 이 폴백에 실질적으로 의존한다([13_기술부채대장](../13_기술부채대장/기술부채_대장.md), [16_Runbook](../16_Runbook_배포롤백/Runbook_배포롤백.md) 5절).
- 개선 방향: baseline 마이그레이션 생성 후 운영에서는 폴백 경로를 제거하고 `migrate deploy`만 사용.

---

## ADR-0006 — 검색을 pg_bigm 우선 + ILIKE 폴백으로 구현

**상태**: Accepted

**맥락**
한국어 규정 본문·제목의 부분 일치 검색이 필요하다. PostgreSQL 기본 `LIKE`/`ILIKE`는 한국어 부분 일치에 인덱스 활용이 어렵다.

**결정**
`pg_bigm` 확장을 설치해 우선 사용하고, 사용 불가 환경에서는 `ILIKE`로 폴백한다. 검색 대상은 규정명·코드 + **게시(published) 상태** 조문 본문/제목. (근거: 마이그레이션 `20250416180000_enable_pgbigm`, `apps/api/src/search/search.service.ts`)

**결과**
- (+) 한국어 2-gram 인덱스로 부분 일치 검색 성능을 확보한다.
- (+) 확장이 없는 환경(로컬 등)에서도 폴백으로 동작한다.
- (−) `pg_bigm`은 표준 PostgreSQL에 없어 커스텀 이미지/설치가 필요하다(인프라 종속성).
- (−) draft/review 조문은 검색에서 제외된다(의도된 동작이나, 편집 중 콘텐츠는 안 잡힘).

---

## ADR-0007 — JWT를 Authorization 헤더로, CORS는 origin reflect

**상태**: Accepted

**맥락**
사용자가 `localhost`, `127.0.0.1`, LAN IP, 실제 도메인 등 다양한 URL로 접속한다. `PUBLIC_URL` 하나로 모든 브라우저 오리진을 열거할 수 없다.

**결정**
인증 토큰은 쿠키가 아닌 `Authorization: Bearer` 헤더로 전달한다. CORS는 `origin: true`(요청 오리진 반사) + `credentials: true`로 설정한다. (근거: `apps/api/src/main.ts`의 `enableCors({ origin: true, credentials: true })` 및 주석)

**결과**
- (+) 어떤 접속 URL에서도 로그인이 동작한다(개발·사내망 편의).
- (+) 토큰이 헤더에 있어 CSRF 표면이 쿠키 방식보다 작다.
- (−) 오리진을 반사하므로 CORS가 사실상 모든 출처를 허용한다. 토큰이 헤더 기반이라 브라우저 자동 전송은 없지만, 운영 환경에서는 허용 오리진 화이트리스트를 고려할 수 있다(보안 검토 여지).
- (−) 토큰이 JS에서 접근 가능한 저장소에 보관되면 XSS에 노출된다 — 프론트 XSS 방어가 중요.

---

## ADR-0008 — PDF 텍스트 추출을 런타임 Python 서브프로세스로 수행

**상태**: Accepted

**맥락**
규정 가져오기에서 PDF의 텍스트·레이아웃을 추출해야 한다. Node 생태계 PDF 파서보다 Python `pdfplumber`/`pymupdf`의 한국어·표 추출 품질이 낫다고 판단.

**결정**
API 런타임 이미지에 Python과 `pdfplumber`·`pymupdf`를 설치하고, Node에서 `spawnSync`로 파이썬 추출 스크립트를 호출한다. (근거: `apps/api/Dockerfile`의 `pip3 install ... pdfplumber pymupdf`, `apps/api/src/regulation-parse/regulation-parse.service.ts`의 `spawnSync`)

**결과**
- (+) PDF 추출 품질을 검증된 Python 라이브러리로 확보한다.
- (−) 이미지에 Python 런타임이 더해져 크기·빌드 시간이 증가한다.
- (−) Node↔Python 프로세스 경계로 오류 처리·성능·배포 복잡도가 늘어난다. 프론트 UI가 아직 없어(regulation-parse UI 미연결, SRS 13.2) 현재는 API로만 사용된다.
- (−) **현재 이 결정은 빌드를 깨뜨린다**: `pip install pymupdf pdfplumber`가 Alpine(musl)에서 C 툴체인/호환 wheel 부재로 실패한다(2026-07-21 스모크 테스트에서 확인, [13_기술부채대장](../13_기술부채대장/기술부채_대장.md) #7). 베이스 이미지(debian-slim) 전환·빌드툴 추가·wheel 고정 중 하나로 재검토 필요.
