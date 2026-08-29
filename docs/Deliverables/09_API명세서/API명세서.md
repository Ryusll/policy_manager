# API 명세서

작성일: 2026-07-21
근거: `apps/api/src/**/*.controller.ts` 전수 확인. 전역 prefix `/api` (예: 실제 경로는 `/api/policies`). Swagger 대화형 문서: `/api/docs`.

## 인증/인가 공통 규칙

- 전역 가드(적용 순서): `JwtAuthGuard` → `PlanGuard` → `RolesGuard` → `ThrottlerGuard` (`apps/api/src/app.module.ts`)
- `@Public()` 표시된 라우트만 JWT 없이 호출 가능, 나머지는 `Authorization: Bearer <accessToken>` 필수
- `@Roles(...)`는 테넌트 내 역할(admin/editor/viewer), `@PlatformRoles('global_admin')`은 SaaS 운영자 전용, `@MinPlan('pro')`는 플랜 하한(PlanGuard)
- 레이트리밋: 100 req/min (`ThrottlerGuard`)
- 요청 바디는 전역 `ValidationPipe`(whitelist, forbidNonWhitelisted, transform) 적용 — DTO에 없는 필드는 자동 거부

## auth (`/api/auth`)

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | login | Public | 이메일/비밀번호 로그인 |
| POST | register | Public | 테넌트 + 최초 admin 계정 생성 |
| GET | google | Public | Google OAuth 시작(redirect). 서명된 `state`와 `oauth_state` 쿠키를 함께 내린다. `GOOGLE_CLIENT_ID/SECRET` 미설정 시 **503** |
| GET | google/callback | Public | Google OAuth 콜백. `state`의 서명·유효시간(10분)·쿠키 대조를 **코드 교환보다 먼저** 확인한다. 실패는 `{PUBLIC_URL}/login?error=oauth&reason=<사유>`로 리다이렉트 |
| POST | refresh | Public | refreshToken으로 재발급. 서명·만료를 검증하고 **매번 새 토큰으로 회전**한다. 잘못된 토큰은 401, 빈 값은 400 |
| POST | logout | JWT | refreshToken 무효화 |
| POST | me | JWT | 현재 로그인 사용자 정보 |

**Google 콜백 실패 사유(`reason`)** — 화면이 그대로 문구로 바꿔 보여 준다(T-42).

| 사유 | 뜻 |
|---|---|
| `state` | `state`가 없거나 위조·만료됐거나 쿠키와 맞지 않음 |
| `not_invited` | 그 조직에 계정이 없음. **Google 로그인은 계정을 만들지 않는다**([ADR-0018](../10_ADR_의사결정기록/ADR.md)) |
| `other_organization` | 이 Google 계정이 다른 조직 소속 |
| `already_registered` | 이미 가입된 Google 계정으로 `mode=register` 요청 |
| `slug_taken` / `invalid_slug` / `missing_tenant_name` | `mode=register`의 조직 코드·이름 문제 |
| `email_unverified` | Google이 이메일 소유를 확인하지 않은 계정 |
| `email_linked_elsewhere` | 그 이메일이 다른 Google 계정에 연결돼 있음 |
| `provider` / `server` | Google 응답 실패 / 서버 오류 |

## users (`/api/users`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 테넌트 사용자 목록 |
| POST | (root) | admin | 팀원 초대(사용자 생성) — Pro+ 플랜 |

## policies (`/api/policies`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 규정 목록(검색·필터) |
| GET | import-logs | admin, editor | 가져오기 이력 |
| POST | import-logs | admin, editor | 가져오기 이력 기록 |
| GET | :id | admin, editor | 규정 상세(조·항·목 정렬 포함) |
| POST | (root) | admin, editor | 규정 생성 |
| PUT | :id | admin, editor | 규정 수정(개정일·시행일·알림 설정 포함) |
| DELETE | :id | admin | 규정 삭제 |
| POST | :id/chapters | admin, editor | 장 생성 |
| PUT | :id/chapters/:chapterId | admin, editor | 장 수정(suppressHeader 등) |
| DELETE | :id/chapters/:chapterId | admin | 장 삭제 |
| POST | :id/chapters/:chapterId/sections | admin, editor | **절 추가** (선택 계층) |
| PUT | :id/chapters/:chapterId/sections/:sectionId | admin, editor | 절 수정 |
| DELETE | :id/chapters/:chapterId/sections/:sectionId | admin | 절 삭제 (소속 조문은 보존, 연결만 해제) |
| POST | :id/chapters/:chapterId/articles | admin, editor | 조문 생성 |
| PUT | :id/chapters/:chapterId/articles/:articleId | admin, editor | 조문 구조·메타 수정 |
| DELETE | :id/chapters/:chapterId/articles/:articleId | admin | 조문 삭제 |
| POST | :id/appendices | admin, editor | 부칙/별표/서식 생성 |
| PUT | :id/appendices/:appendixId | admin, editor | 부칙/별표/서식 수정 |
| DELETE | :id/appendices/:appendixId | admin | 부칙/별표/서식 삭제 |
| GET | :id/revision-reasons | admin, editor | **제정·개정 이유 목록** (문서 차수별 개정문) |
| POST | :id/revision-reasons | admin, editor | 제정·개정 이유 추가 |
| PUT | :id/revision-reasons/:reasonId | admin, editor | 제정·개정 이유 수정 |
| DELETE | :id/revision-reasons/:reasonId | admin, editor | 제정·개정 이유 삭제 |
| GET | :id/effective-dates | admin, editor | **시점 조회용** — 본문이 바뀐 시행일 목록(내림차순) |
| GET | :id/as-of | admin, editor | **시점 조회** — 기준일에 시행 중이던 본문. Query: `date`(YYYY-MM-DD) |
| GET | :id/compare | admin, editor | **신구조문대비표** — 두 시점 본문을 조문 단위로 대비. Query: `from`, `to`(YYYY-MM-DD) |
| POST | :id/export/pdf | admin, editor | **전문 PDF 내보내기.** Body는 전문 보기 렌더 HTML, 응답은 `application/pdf`. 동기 처리이며 감사 로그에 `policy.export.pdf` 로 남는다([ADR-0015](../10_ADR_의사결정기록/ADR.md)) |
| POST | :id/export/hwpx | JWT | **전문 한/글 내보내기.** Body는 같은 HTML, 응답은 `application/hwp+zip`. **`.hwp` 가 아니라 `.hwpx`** — `.hwp` 는 독점 바이너리라 서버에서 만들 수 없다([ADR-0016](../10_ADR_의사결정기록/ADR.md)). 한/글 2014 이상에서 열린다. 감사 로그 `policy.export.hwpx` |
| POST | :id/files | admin, editor | 첨부파일 업로드 |
| GET | :id/files | JWT | 첨부파일 목록 |
| GET | :id/files/:filename | JWT | 첨부파일 다운로드 |
| DELETE | :id/files/:filename | admin, editor | 첨부파일 삭제 |

> **첨부파일 4종 공통(T-41)**: 규정 소유를 먼저 확인하므로 남의 규정이면 404다. `:id`·`:filename` 은 형식 검사를 통과해야 하며(UUID / 저장 파일명), 조립 경로가 업로드 루트를 벗어나면 400. 예전에는 인코딩한 슬래시로 경로를 거슬러 올라가 컨테이너의 임의 파일을 읽고 지울 수 있었다.

| GET | :id/jo-order | JWT | 조 재정렬 시작점 — 현재 조 차례(`[{chapterId, jo}]`) |
| PUT | :id/jo-order | admin·editor | 조 순서 일괄 재정렬·번호 재부여. Body: `order: [{chapterId, jo}]` — **규정의 모든 조를 문서 순서대로 한 번씩**. `jo` 는 옮기기 전 번호. 빠지거나 겹치면 400. 조에 딸린 항·목 행도 함께 움직이고, 장이 바뀌면 절 지정은 풀린다(T-60) |

## versions (`/api/articles/:articleId/versions`, `/api/versions/:id`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | articles/:articleId/versions | admin, editor | 조문 버전 목록 |
| POST | articles/:articleId/versions | admin, editor | 초안(draft) 버전 생성 |
| GET | versions/:id | admin, editor | 버전 상세 |
| PUT | versions/:id | admin, editor | 초안 본문·변경메모 수정 |
| POST | versions/:id/submit | admin | 검토 요청 (draft→review) |
| POST | versions/:id/approve | admin | 시행 승인 (review→published, 이전 published는 archived). **`effectiveDate` 확정 — 시점 조회의 기준** |
| POST | versions/:id/reject | admin | 검토 반려(review→draft). Body: `reason`(**필수**) — 사유는 버전의 `reviewNote` 에 남아 편집자에게 보인다. 다시 검토 요청하면 지워진다 (T-10) |
| POST | versions/:id/archive | admin | 게시본 폐지(published→archived). 응답에 `remainingPublished` — 0이면 이 조문에 게시본이 없다(전문 보기·인쇄에 본문 없이 나온다) (T-10) |
| GET | versions/diff | admin, editor | 두 버전 diff. Query: `v1`, `v2`(버전 ID) |

## comments (`/api/articles/:articleId/comments`, `/api/comments/:id`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | articles/:articleId/comments | admin, editor, viewer | 조문 코멘트 목록 |
| POST | articles/:articleId/comments | admin, editor, viewer | 코멘트 작성 |
| PATCH | comments/:id | admin, editor | 처리완료/미처리 토글 |

## variables (`/api/variables`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 변수 목록 |
| GET | :id | admin, editor | 변수 상세 |
| POST | (root) | admin, editor | 변수 생성 |
| PUT | :id | admin | 변수 수정 |
| DELETE | :id | admin, editor | 변수 삭제 |
| POST | :id/usages | admin, editor | 버전-변수 사용 이력 등록 |

## search (`/api/search`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | JWT | 통합검색. Query: `q`(필수), `page`(기본 1), `limit`(기본 20) |
| GET | related-preview | JWT | 판·법·규 연관 미리보기. Query: `type`(precedent\|law\|rule, 필수), `q`(필수), `limit`(기본 5), `sort`(relevance\|latest), `scope`(title\|fulltext) |

## templates (`/api/templates`)

> 컨트롤러 전체에 `@MinPlan('pro')`가 적용되어 **Starter 플랜은 모든 템플릿 엔드포인트가 차단**된다(403).

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | JWT (Pro+) | 출력 템플릿 목록 |
| GET | :id | JWT | 템플릿 상세 |
| GET | :id/revisions | JWT | 템플릿 변경 이력(audit 기반) |
| POST | (root) | admin | 템플릿 생성 (Pro: basic 모드, Enterprise: HTML/CSS) |
| PUT | :id | admin | 템플릿 수정 |
| DELETE | :id | admin | 템플릿 삭제 |
| POST | :id/clone | admin | 템플릿 복제 |
| POST | :id/set-default | admin | 테넌트 기본 템플릿 지정 |
| POST | :id/restore | admin | 지정한 이력 시점으로 복원. Body: `revisionId`(=`:id/revisions` 의 `id`). 감사 로그에 `template.restore` 로 남아 일반 수정과 구분된다(T-58) |

## tenant-branding (`/api/tenant-branding`)

> 회사(테넌트) 브랜딩. 플랫폼(운영사) 브랜딩인 `/platform-branding` 과 다르다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | JWT | 회사 로고·배지 문자 조회. **플랜·역할 제한 없음** — 헤더는 모든 구성원이 그린다. 저장된 적 없으면 기본값 + `updatedAt: null` |
| PUT | (root) | admin (Pro+) | 저장. Body: `brandMark`(2자로 잘림), `logoDataUrl`(`data:image/…` 만, 350KB 이하), `logoWidth`·`logoHeight`(16~96) |

## notifications (`/api/notifications`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | JWT | 알림 목록 |
| GET | unread-count | JWT | 미읽음 수 |
| PATCH | :id/read | JWT | 알림 읽음 처리 |
| POST | read-all | JWT | 전체 읽음 처리 |

## notification-groups (`/api/notification-groups`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 알림 수신 팀 목록 |
| POST | (root) | admin | 알림 수신 팀 생성 |
| PATCH | :id | admin | 팀명·멤버 수정 |
| DELETE | :id | admin | 팀 삭제 |

## regulation-parse (`/api/regulation-parse`) — 화면: `/policies/import` (T-12, 8/12)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | upload | admin, editor | PDF 업로드 → 텍스트 추출(Python pdfplumber/pymupdf). 최대 30MB. (빌드 블로커는 T-01에서 해소됨) |
| GET | :id | admin, editor, viewer | 파싱 세션 조회 |
| PATCH | :id/tree | admin, editor | 파싱 트리 수정. DTO에 `@Type(() => Object)` 필수 — 없으면 전역 ValidationPipe가 노드를 `[]`로 만든다(C-14) |
| POST | :id/commit | admin, editor | 파싱 결과 → 규정(Policy) 커밋. 응답 `{policyId, sessionId, articleCount}`. **현재 트리를 전부 조(條)로 평탄화** — 항·목 매핑은 T-88 |

## admin (`/api/admin`)

> 관리자(`admin`) 전용. 규정 가져오기 화면의 **JSON 일괄 등록** 탭에서 쓴다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | import/policies/validate | admin | **사전 검사**(200). 넣지 않고 문제를 전부 모아 돌려준다. 응답 `{issues[], canImport, summary}` (T-13) |
| POST | import/policies | admin | 일괄 등록. 한 트랜잭션 — 하나라도 걸리면 전부 무산된다. 검사에 걸리면 400 + `issues` |

> **사전 검사가 보는 것**: 코드 중복(기존/파일 안), 빈 코드·제목, 길이 초과, 장·조 번호 형식 → 오류. 장 없음, 빈 본문, 조 번호 겹침·건너뜀 → 경고. **플랜 규정 상한**도 여기서 본다 — 예전에는 일괄 가져오기가 상한을 통과해 Starter(5건)가 한 번에 100건을 넣을 수 있었다.

## audit (`/api/audit-logs`)

> 관리자(`admin`) 전용. 감사 로그에는 다른 구성원의 활동이 함께 담긴다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin | 목록. Query: `action`(정확히 일치 / 끝에 `.` 이면 접두어 묶음), `userId`, `from`·`to`(YYYY-MM-DD, **종료일 당일 포함**), `page`, `limit`(기본 50, 최대 200). 응답 `{rows, total, page, limit}`. **`rows` 에는 `details` 본문이 없다** — `hasDetails`·`keys` 만 (T-11) |
| GET | actions | admin | 이 회사에 쌓인 액션 종류·건수 (필터 드롭다운용) |
| GET | actors | admin | 기록을 남긴 적 있는 사용자 목록 (필터용) |
| GET | :id | admin | 기록 상세 — `details` 본문 포함 |

> **목록에서 `details` 를 뺀 이유**: 템플릿 수정 기록의 `details` 에는 before/after 스냅샷(레이아웃 JSON + CSS 전문)이 들어 있어, 50건이면 응답이 수 MB 가 된다. 목록에서는 펼치기 전까지 쓰지 않는다.

## billing (`/api/billing`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | checkout | admin | 플랜 업그레이드 체크아웃 (mock: 즉시 반영). 성공 시 **구독·결제 기록을 남기고** `tenant.planExpiresAt` 을 구독 종료일로 채운다 (T-17) |
| GET | history | admin | 결제·구독 이력. 응답 `{currentSubscription, subscriptions[], payments[]}` |
| POST | webhook | Public | 결제 프로바이더 웹훅 수신. `data.amount`·`data.orderId` 를 결제 기록에 남긴다 |

> **mock 결제는 0원으로 기록된다** — 실제로 돈이 오가지 않으므로 요금표를 지어내 넣지 않는다(`metadata.mock: true`). 실 PG 를 붙이면 결제사가 알려 준 금액을 쓴다(요금 정책은 D-03).
> **구독 전이**: 같은 요금제를 다시 사면 기존 구독을 **연장**(이력이 쪼개지지 않게), 요금제가 바뀌면 이전 구독을 `canceled` 로 닫고 새로 연다(활성 구독은 항상 1개).

## platform-admin (`/api/platform-admin`) — `global_admin` 전용
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | tenants | global_admin | 테넌트 목록 |
| GET | tenants/:tenantId/users | global_admin | 테넌트 사용자 목록 |
| PATCH | tenants/:tenantId/plan | global_admin | 테넌트 플랜 변경 |
| PATCH | tenants/:tenantId/users/:userId/role | global_admin | 테넌트 내 역할 변경 |
| PATCH | users/:userId/platform-role | global_admin | 플랫폼 역할(global_admin) 부여/해제 |
| PATCH | branding | global_admin | 플랫폼 브랜딩(법인명·로고 등) 수정 |

## platform-branding (`/api/platform-branding`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | Public | 플랫폼 브랜딩 조회 (푸터·헤더용 공개 API) |

## integrations (`/api/integrations`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | api-access | JWT | Enterprise API 연동 안내 정보 |

## health (`/api/health`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | Public | 헬스체크 (docker-compose healthcheck가 호출) |

---

# 부록 A. 요청 DTO 스키마

각 모듈 `*.dto.ts`의 `class-validator` 제약을 그대로 옮긴 것이다. `?`는 optional(`@IsOptional`), 별도 표기 없으면 필수. 전역 `ValidationPipe`(whitelist·forbidNonWhitelisted)로 **DTO에 없는 필드는 400으로 거부**된다.

## auth
**LoginDto** — `email`(이메일, 자동 trim+소문자), `password`(문자열, 최소 6자), `tenantSlug?`(문자열, trim+소문자)
**RegisterDto** — `tenantName`, `tenantSlug`, `email`(이메일), `password`(최소 6자), `name`
**RefreshTokenDto** — `refreshToken`(문자열, 빈 값 불가)

## users
**CreateUserDto** — `email`(이메일), `password`(최소 6자), `name`, `role`(admin|editor|viewer)

## policies
**CreatePolicyDto** — `code`, `title`, `description?`, `department?`(≤100), `category?`(≤100), `templateId?`
**UpdatePolicyDto** — `title?`, `description?`, `department?`(≤100), `category?`(≤100), `isActive?`(bool), `templateId?`(null로 해제 가능), `revisionDate?`(YYYY-MM-DD, null 가능), `effectiveDate?`(YYYY-MM-DD, null 가능), `revisionNotify?`(아래 PolicyRevisionNotifyDto)
**CreateChapterDto** — `number`(정수≥1), `title?`, `suppressHeader?`(bool)
> **보이는 장은 제목이 있어야 한다.** `suppressHeader`가 아닌데 제목이 비면 400. 숨김 장은 제목 없이 만들 수 있고 기본 이름(`본문`)이 채워진다. 생성·수정 모두 같은 규칙이다(T-84).
**CreateSectionDto** — `number`(정수≥1), `title`(≤300)
**UpdateSectionDto** — `number?`(≥1), `title?`(≤300)
**UpdateChapterDto** — `number?`(≥1), `title?`, `suppressHeader?` — 생성과 같은 규칙. 보이는 장의 제목을 빈 값으로 바꾸면 400
**CreateArticleDto** — `number`(정수≥1), `sectionId?`(소속 절, 미지정 시 장 직속), `title?`(항·목만 추가 시 생략), `clauseNumber?`(≥1), `itemNumber?`(≥1), `hasPrecedent?`/`hasRelatedLaw?`/`hasRelatedRule?`(bool), `relatedPrecedentNote?`/`relatedLawNote?`/`relatedRuleNote?`(≤8000), `content?`
**UpdateArticleDto** — `number?`(≥1), `sectionId?`(절 이동. `null`이면 절에서 분리), `title?`, `clauseNumber?`(null로 비우기), `itemNumber?`(null로 비우기), has* 플래그, related*Note(≤8000)
**CreatePolicyAppendixDto** — `kind`(supplementary=부칙|annex=별표|form=서식), `title`(≤500), `body`(≤500000), `sortOrder?`(≥0)
**UpdatePolicyAppendixDto** — 위 필드 전부 optional
**CreatePolicyImportLogDto** — `policyId?`, `sourceName?`, `parseProfile?`(mixed|korean|english), `chapterCount?`(≥0), `articleCount?`(≥0), `cleanupOptions?`(JSON), `status?`, `message?`
**CreateRevisionReasonDto** — `kind?`(enactment=제정|amendment=일부개정|full_amendment=전부개정|repeal=폐지, 기본 amendment), `label`(≤200, 예 "제3차 일부개정"), `reason`(≤100000), `summary?`(≤100000), `promulgatedDate?`(YYYY-MM-DD), `effectiveDate?`(YYYY-MM-DD)
**UpdateRevisionReasonDto** — 위 필드 전부 optional
**ExportPolicyPdfDto** — `html`(전문 보기 렌더 결과, ≤4MB — 서버에서 sanitize 후 변환), `title?`(≤300), `metaLine?`(≤500), `footerText?`(≤500), `pageNumbers?`(기본 true)

### 신구조문대비표(compare) 응답 규칙
- 두 시점의 as-of 스냅샷을 **`articleId` 기준**으로 짝짓는다. 조 번호는 개정으로 바뀔 수 있어 번호로 맞추면 엉뚱한 조문끼리 비교된다.
- `kind`: `added`(신설) / `removed`(삭제) / `changed`(개정) / `same`(변동없음). 본문이 같아도 **제목이 바뀌면 `changed`**.
- 비교 전 공백·줄바꿈을 정규화하므로 서식 차이만으로는 개정이 되지 않는다(표시는 원문 그대로).
- `diff`는 `changed`일 때만 채우며 낱말 단위(`diffWords`) `{value, added?, removed?}` 배열이다.
- 표기 위치(`number`/`clauseNumber`/`itemNumber`)는 신조문 기준, 삭제된 조문만 구조문 기준.
- `from > to`면 400.

### 시점 조회(as-of) 응답 규칙
- 조문별로 **시행일 ≤ 기준일인 `published`/`archived` 버전 중 가장 나중** 것을 고른다.
- 기준일에 아직 시행되지 않은 조문은 응답에서 **제외**한다(그날 존재하지 않던 조문).
- 응답은 `GET :id`와 같은 형태 + `asOf: { date, omittedArticles, hasEffectiveDates }`. 전문 보기·인쇄·PDF가 그대로 재사용한다.

## versions
**CreateVersionDto** — `content`(문자열), `changeNote?`
**UpdateVersionDto** — `content?`, `changeNote?`
**ApproveVersionDto** — `changeNote`(필수, 최소 1자 — "개정 사유를 입력하세요"), `effectiveDate?`(YYYY-MM-DD, 생략 시 승인일 — **시점 조회의 기준**)

## comments
**CreateArticleCommentDto** — `content`(1~2000자)
**UpdateArticleCommentDto** — `isResolved?`(bool)

## variables
**CreateVariableDto** — `key`(1~120, 예 `COMPANY_NAME`), `label`(1~200), `defaultValue?`(≤2000), `description?`(≤2000)
**UpdateVariableDto** — `label?`(1~200), `defaultValue?`(≤2000), `description?`(≤2000)

## templates
**CreateTemplateDto** — `name`(≤120), `description?`(≤500), `isDefault?`(기본 false), `isActive?`(기본 true), `layoutJson`(객체, `rawHtml` 문자열 포함 가능), `cssText?`(기본 "")
**UpdateTemplateDto** — 위 필드 전부 optional
**CloneTemplateDto** — `name?`(≤120, 미입력 시 "(복제)" 접미사)

## notifications
**PolicyRevisionNotifyDto**(policies.update에서 사용) — `enabled?`(bool), `userIds?`(문자열 배열, 유니크), `groupIds?`(문자열 배열, 유니크)
**CreateNotificationGroupDto** — `name`(≤80, 예 "정보보안팀"), `userIds?`(문자열 배열)
**UpdateNotificationGroupDto** — `name?`(≤80), `userIds?`

## regulation-parse
**UpdateRegulationParseTreeDto** — `roots`(배열)
**CommitRegulationParseDto** — `code`(1~80), `title`(1~500), `description?`(≤4000)
(upload는 multipart 파일 업로드)

## billing
**CheckoutDto** — `targetPlan`(pro|enterprise)
**BillingWebhookDto** — `type`(예 `payment.succeeded`), `data`{ `tenantSlug`, `targetPlan`, `paymentId?` }

## platform-admin
**UpdateTenantPlanDto** — `plan`(starter|pro|enterprise), `billingStatus`(active|trial|past_due|canceled), `planExpiresAt?`(ISO-8601, 미입력 시 해제)
**UpdateTenantUserRoleDto** — `role`(admin|editor|viewer)
**UpdatePlatformRoleDto** — `platformRole`(none|global_admin)
**TenantListQueryDto** — `q?`(회사명/slug 검색)
**UpdatePlatformBrandingDto** — `legalName?`(≤200), `registrationNo?`(null 가능), `productLabel?`(≤160), `logoDataUrl?`(data URL 또는 null), `lockupImageSrc?`(≤512)

## admin
**ImportPoliciesDto** — `policies[]`{ `code`, `title`, `description?`, `chapters[]?`{ `number`(≥1), `title?`, `suppressHeader?`(bool), `articles[]?`{ `number`(≥1), `title`, `content?`, `publish?`(true면 v1 즉시 published) } }, `articles[]?` }

- 장 제목은 **`suppressHeader: true`일 때만 생략**할 수 있다. 그냥 비워 두면 400이다(실수와 의도를 구분한다).
- **장 없는 규정**은 `policy.articles[]`(최상위)로 넣는다. 서버가 숨김 장 한 건으로 눕혀 담는다 — 없는 장 제목을 지어낼 필요가 없다(T-84, [ADR-0019](../10_ADR_의사결정기록/ADR.md)). `chapters`와 함께 쓰면 마지막 장 뒤에 붙는다.

---

# 부록 B. 공통 규약

## 응답 형식
- 성공 응답은 각 서비스가 반환하는 리소스 객체(JSON)를 그대로 직렬화한다. 표준 envelope(`{ data, meta }`) 래핑은 사용하지 않는다. 검색만 페이지네이션 메타를 포함한다.
- 인증은 `Authorization: Bearer <accessToken>` 헤더로 전달한다(쿠키 아님).

## 에러 형식 (NestJS 기본)
```json
{ "statusCode": 400, "message": ["..."], "error": "Bad Request" }
```
| 코드 | 발생 상황 |
|---|---|
| 400 Bad Request | DTO 검증 실패, whitelist 위반(정의 안 된 필드), 잘못된 값 |
| 401 Unauthorized | 토큰 없음/만료, 웹훅 시크릿 불일치 |
| 403 Forbidden | 역할(`@Roles`)·플랫폼역할(`@PlatformRoles`)·플랜(PlanGuard) 미충족 |
| 404 Not Found | 리소스 없음 또는 타 테넌트 리소스 접근(테넌트 필터로 조회 불가) |
| 429 Too Many Requests | 레이트리밋(100 req/min) 초과 |

## 참고
- 실행 중 `/api/docs`(Swagger)에서 위 스키마를 대화형으로 확인·시험할 수 있다.
- 플랜별 기능 제한(Starter/Pro/Enterprise)은 [03_SRS_요구사항명세](../03_SRS_요구사항명세/SRS_요구사항명세.md) 참고.
- UI가 연결되지 않은 API 전용 엔드포인트는 [13_기술부채대장](../13_기술부채대장/기술부채_대장.md)에서 추적.
- 본 부록은 소스의 DTO를 옮긴 것이다. 2026-07-21 스모크 테스트로 auth/policies/search/me/health/platform-branding 엔드포인트의 상태코드·응답 형태를 실측 확인했다([16_Runbook 9절](../16_Runbook_배포롤백/Runbook_배포롤백.md)). 나머지 엔드포인트의 응답 필드는 여전히 소스(`*.service.ts` 반환값) 기준이며 개별 실측은 미완료.
- 실측 참고: 공개 브랜딩 응답은 입력 DTO의 `logoDataUrl`이 아니라 `logoUrl` 필드로 반환된다(공개 컨트롤러가 형태를 변환). 요청 DTO와 응답 형태가 다를 수 있으니 응답은 실제 호출로 확인 권장.

---

# 부록 C. 출력 템플릿 토큰 계약

작성 근거: `apps/web/src/components/policy-template/templateTokens.ts` (단일 소스).
Pro 기본 빌더(`basicConfig`)와 Enterprise 자유 HTML(`rawHtml`)이 **같은 토큰 집합**을 참조한다. 템플릿에는 `{{경로}}` 형태로 쓴다.

| 토큰 | 종류 | 설명 |
|---|---|---|
| `{{tenant.name}}` | 텍스트 | 테넌트(고객사) 이름 |
| `{{policy.title}}` | 텍스트 | 규정 제목 |
| `{{policy.code}}` | 텍스트 | 규정 코드 |
| `{{today}}` | 텍스트 | 출력일 (ko-KR) |
| `{{revisionDate}}` | 텍스트 | 개정일. 미설정 시 빈 문자열 |
| `{{effectiveDate}}` | 텍스트 | 시행일. 미설정 시 빈 문자열 |
| `{{content}}` | HTML | 조·항·목 구조를 유지한 규정 전문. 본문 텍스트는 이스케이프됨 (렌더 시점 주입) |
| `{{logo}}` | HTML | 테넌트 브랜딩 로고 `<img>`. 로고 없으면 빈 문자열 (렌더 시점 주입) |

**규칙**
- 목록에 없는 토큰은 렌더 시 **빈 문자열로 제거**된다. 에디터가 미지원 토큰을 경고로 표시한다.
- `{{content}}`가 만드는 마크업의 시맨틱 클래스(`.tmpl-chapter`, `.tmpl-chapter-title`, `.tmpl-article-body` 등)를 CSS로 스타일링한다.
- 토큰을 추가할 때는 `templateTokens.ts`의 `TEMPLATE_TOKENS`와 `buildTemplateTokenData`를 함께 수정한다(한쪽만 고치면 목록과 실제 값이 어긋난다).
- 조문 단위 토큰(`{{article.number}}` 등)은 **지원하지 않는다**. 조문은 `{{content}}` 안에서 렌더된다.

**sanitize**: 템플릿 HTML/CSS는 저장 시 서버(`sanitize-html`)에서, 렌더 시 클라이언트(`DOMPurify`)에서 정화된다. 허용 태그·속성 목록은 서버 `templates.service.ts`와 클라이언트 `templateSanitize.ts`에 있고 **함께 유지보수해야 한다**. 스크립트·프레임·폼 계열 태그와 `on*` 이벤트 핸들러는 전부 제거된다.

---
