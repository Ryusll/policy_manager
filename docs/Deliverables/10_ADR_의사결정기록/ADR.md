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
| ADR-0009 | 템플릿 sanitize를 서버 sanitize-html + 클라이언트 DOMPurify로 이원화 | Accepted |
| ADR-0010 | 가져오기 항·목 추론을 클라이언트에서 수행 | Accepted |
| ADR-0011 | 절(節)을 선택 계층으로 추가하되 Article.chapterId는 필수로 유지 | Accepted |

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
- (−) 가져오기 시 항·목 매핑이 파서의 별도 추론에 의존한다(DB가 계층을 강제하지 않으므로). 2026-07-30 [ADR-0010](#adr-0010--가져오기-항목-추론을-클라이언트에서-수행)으로 추론을 추가해 수동 편집 부담은 해소했다.

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

---

## ADR-0009 — 템플릿 sanitize를 서버 sanitize-html + 클라이언트 DOMPurify로 이원화

**상태**: Accepted (2026-07-30)

**맥락**
Enterprise 플랜은 출력 템플릿의 HTML/CSS를 자유 편집할 수 있다. 기존 sanitize는 서버·클라이언트 모두 정규식으로 위험 태그·속성을 지우는 방식이었는데, 실측에서 **따옴표 없는 이벤트 핸들러**(`<img src=x onerror=alert(1)>`)와 허용목록에 없던 태그(`<svg onload=…>`, `<details ontoggle=…>`)가 통과했다(대표 벡터 6건 중 5건 우회). 정규식으로 HTML을 파싱하려는 접근 자체의 한계다.

**결정**
허용목록(allowlist) 기반 라이브러리로 교체한다. 서버는 `sanitize-html`(순수 Node), 클라이언트는 `DOMPurify`(브라우저 DOM 기반)를 사용한다. **서버를 보안 경계**로 삼아 저장 시점에 정화하고, 클라이언트 sanitize는 렌더 시 2차 방어로 둔다. CSS는 두 라이브러리의 대상이 아니므로 `expression()`·`behavior:`·`@import`·`url(javascript:)`·`</style>` 탈출을 제거하는 별도 정책을 양쪽에 둔다.

**대안**: 한쪽 라이브러리를 양쪽에서 쓰기(`isomorphic-dompurify`). 서버에 jsdom이 필요해 이미지가 무거워지고, 이미 취약한 Docker 빌드(ADR-0005·기술부채 #7)의 실패 지점을 늘릴 위험이 있어 채택하지 않았다.

**결과**
- (+) XSS 벡터 11건 전부 차단 확인. 정상 템플릿(`.tmpl-*` 클래스, data URI 로고)은 보존됨.
- (+) 새 우회 기법은 라이브러리 업데이트로 흡수된다(정규식 유지보수 부담 제거).
- (−) **허용목록이 서버·클라이언트 두 곳에 존재한다.** 한쪽만 고치면 정책이 어긋난다(토큰에서 겪은 drift 문제와 동일 구조). 지금은 주석·문서로 "함께 수정" 규약을 두었고, 공용 패키지(`packages/*`)로 추출하는 것은 후속 과제.
- (−) `<a>`는 기존 고객 템플릿 호환을 위해 허용했다(DOMPurify·sanitize-html의 URI 스킴 검사에 의존).

---

## ADR-0010 — 가져오기 항·목 추론을 클라이언트에서 수행

**상태**: Accepted (2026-07-30)

**맥락**
가져오기 파서는 조 단위(`number`/`title`/`content`)까지만 만들고 항(①②…)·목(1. 2. …)은 본문 텍스트에 섞여 있었다. 조·항·목 편집 기능은 이미 완성돼 있었으나 입구가 끊겨 "가져온 뒤 전부 수동 정리"가 필요했다(개발정의서 8.3의 명시된 한계).

**결정**
추론을 **클라이언트(`apps/web/src/lib/policyImportHierarchy.ts`)** 에서 수행한다. 기존 파싱·정제·미리보기 파이프라인이 모두 클라이언트에 있어 같은 자리에서 미리보기(인식된 항·목 개수)를 보여줄 수 있기 때문이다. 등록 시 `clauseNumber`/`itemNumber`를 채워 기존 조문 생성 API로 보낸다(API 변경 없음). 오인식 대비로 「항·목 자동 인식」 토글을 두고 기본 ON.

**결과**
- (+) 백엔드 변경 없이 연결고리를 메웠다. 기존 파서·분할모드·정제 옵션과 조합해 동작한다.
- (+) 보수적 매칭으로 오인식을 줄였다: `2026. 1. 1.` 같은 날짜는 목으로 보지 않고, 상위 항이 없는 `1.`은 조 본문으로 남긴다.
- (−) 서버 측 가져오기 경로(`POST /admin/import/policies`, `regulation-parse`)는 이 추론을 **거치지 않는다.** 해당 경로로 들어온 데이터는 여전히 조 단위다. 법제처 연동(T-54)에서 매퍼를 만들 때 이 로직을 서버와 공유할지 재검토가 필요하다.

---

## ADR-0011 — 절(節)을 선택 계층으로 추가하되 `Article.chapterId`는 필수로 유지

**상태**: Accepted (2026-08-02)

**맥락**
법령은 `편 > 장 > 절 > 조 > 항 > 목` 구조를 갖지만, 사내 규정은 이를 반드시 따르지 않는다. 짧은 내규는 장·절 없이 `제1조`부터 시작하는 경우가 흔하다. 대표 지시(2026-08-02)로 ① 절 계층을 추가하고 ② 장 없이 조부터 만들 수 있어야 한다는 요구가 확정됐다.

"조는 필수, 장·절은 선택"이 정석이지만, `Article.chapterId`를 nullable로 바꾸면 **모든 조회 경로가 영향받는다.** 현재 조문은 `Article → Chapter → Policy`로만 규정에 도달하므로(테넌트 격리도 이 경로에 의존), nullable로 만들려면 `Article.policyId`를 새로 두고 전 서비스·목차·검색·렌더러의 조인을 다시 짜야 한다.

**결정**
- `Section` 모델을 신설하고 `Article.sectionId`를 **nullable**로 둔다. 절에 속하지 않는 조와 속하는 조가 같은 장에 공존할 수 있다.
- `Article.chapterId`는 **필수로 유지**한다. 대신 장이 없는 규정은 `suppressHeader: true`인 장 1건을 만들어 담고, 목차·전문·인쇄에서 장 제목을 표시하지 않는다. 사용자에게는 "장이 없는 규정"으로 보인다.
- 가져오기 경로가 원문에 장이 없을 때 임의로 붙이던 `"제1장 총칙"`/`"원문"` 제목을 없애고 숨김 장을 쓰도록 고친다.

**대안**: `Article.chapterId` nullable + `Article.policyId` 추가. 정석에 가깝지만 조인·테넌트 격리 경로를 전면 수정해야 하고, 자동화 테스트가 없는 현 상태([기술부채 #1](../13_기술부채대장/기술부채_대장.md))에서 회귀 위험이 크다고 판단해 보류했다.

**결과**
- (+) 사용자 관점의 요구("장 없이 조부터")를 스키마 대수술 없이 충족한다.
- (+) 절을 쓰는 규정과 쓰지 않는 규정을 한 모델로 다룬다.
- (−) DB상으로는 여전히 조가 장에 종속된다. "장 없음"은 **숨김 장이라는 관례**로 표현되므로, 이 관례를 모르는 코드가 빈 제목 장을 그대로 노출할 위험이 있다(`isChapterHeaderHidden` 헬퍼를 반드시 경유해야 함).
- (−) 정석 구조로 가려면 후속 마이그레이션이 필요하다. 테스트 기반이 갖춰진 뒤 재검토한다.
