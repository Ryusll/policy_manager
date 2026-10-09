# API 명세서

작성일: 2026-07-21 (최종 갱신: 2026-09-21)
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
| POST | login | Public | 이메일/비밀번호 로그인. 응답 `user.mustChangePassword` 가 true 면 화면은 비밀번호 변경부터 시킨다(T-122) |
| POST | register | Public | 테넌트 + 최초 admin 계정 생성. **공개 회원가입이 닫힌 서버(운영 기본)에서는 403 `code: SIGNUP_CLOSED`** — 고객사는 아스트룸이 `POST /platform-admin/tenants` 로 개설한다. 개발·CI 만 `ALLOW_PUBLIC_SIGNUP=true` (T-122) |
| GET | options | Public | 로그인 화면 설정 `{ publicSignup }` — 회원가입 링크를 보일지 (T-122) |
| GET | google | Public | Google OAuth 시작(redirect). 서명된 `state`와 `oauth_state` 쿠키를 함께 내린다. `GOOGLE_CLIENT_ID/SECRET` 미설정 시 **503**. `mode=register`(구글로 새 조직 만들기)는 공개 회원가입이 닫혀 있으면 구글로 가기 전에 `/login?error=oauth&reason=signup_closed` 로 돌려보낸다(T-122) |
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

> **첫 로그인 비밀번호 변경 (T-122)** — 다른 사람이 정해 준 비밀번호(아래 `POST (root)`·`POST :id/password`, 아스트룸의 고객사 개설, 서버 재설정 스크립트)로 만든 계정은 `mustChangePassword=true` 다. 그 상태에서는 `POST me/password`·`POST /auth/me`·`POST /auth/logout` 과 공개 경로 외 **모든 요청이 403 `code: PASSWORD_CHANGE_REQUIRED`** 다(전역 가드, 인증 직후). 본인이 비밀번호를 바꾸면 풀린다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 테넌트 사용자 목록. 각 사용자에 `mustChangePassword`(첫 로그인 전 여부) |
| POST | (root) | admin | 팀원 초대(사용자 생성). **플랜 무관** — 플랜별 사용자 상한(`maxUsersForPlan`: Starter 10 / Pro 50)만 강제한다(D-07 정리, 2026-10-08). 만든 계정은 첫 로그인 때 비밀번호를 바꿔야 한다(T-122) |
| PATCH | me | 로그인한 모든 역할 | **내 이름 수정**(플랜·역할 무관). 이름 외의 항목(`role`·`email` 등)을 보내면 **400** — 일반 사용자가 이 경로로 역할을 올리지 못하게 DTO 가 막는다 (T-113) |
| PATCH | :id | admin | **같은 기관 사용자의 이름·이메일·역할 수정.** 보낸 항목만 바뀌고, 값이 그대로면 감사 로그를 남기지 않는다. **플랜 게이트 없음**(이미 있는 구성원을 고치는 일이라 초대와 달리 유료 경계가 아니다). 다른 조직 사용자는 **404**, 같은 조직의 이메일 중복(대소문자 무시)은 **409**, **조직의 마지막 admin 을 내리면 409**(동시 요청에도 — 조직 단위로 직렬화). 역할은 JWT 가 아니라 요청마다 DB 에서 읽으므로 **다음 요청부터 즉시** 적용된다. 비밀번호·`platformRole` 은 이 경로로 못 바꾼다(400). 감사 액션: 이름·이메일 `user.updated`, 역할 `user.role_changed` (T-113) |
| POST | me/password | 로그인한 모든 역할 | **내 비밀번호 변경.** 현재 비밀번호를 확인한다(토큰만 훔친 사람이 계정을 가로채지 못하게). 틀리면 **400** — 401 이면 화면이 토큰 갱신·로그아웃 경로를 탄다. 새 비밀번호는 8자 이상·72바이트 이하(bcrypt 한도, 한글은 글자당 3바이트)·현재와 달라야 한다. 성공하면 `refreshToken` 을 비워 **모든 기기의 세션 갱신이 끊긴다**(화면은 로그인 화면으로 이동). Google 전용 계정(비밀번호 없음)은 400. 감사 `user.password_changed`(비밀번호는 기록하지 않음) (T-114) |
| POST | :id/password | admin | **다른 구성원의 비밀번호 재설정**(임시 비밀번호). 이메일 발송이 없어 "비밀번호 찾기" 링크는 만들 수 없다 — 관리자가 정해 전달한다. **본인에게는 400**(현재 비밀번호 확인을 건너뛰는 경로가 되므로). 다른 조직은 404. 대상의 세션을 끊는다. 재설정된 계정은 다음 로그인 때 비밀번호를 바꿔야 한다(T-122). 감사 `user.password_reset` (T-114) |

## policies (`/api/policies`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin, editor | 규정 목록(검색·필터) |
| GET | import-logs | admin, editor | 가져오기 이력 |
| POST | import-logs | admin, editor | 가져오기 이력 기록 |
| GET | :id | admin, editor | 규정 상세. 조문은 **조 → 가지(`branchNumber`, 제3조의2) → 조 본문 → 항 → 목** 순. 조문마다 `versions`(최신 시행본 1건)와 `_count.comments`(**처리 안 된** 의견 수). **admin·editor 에게만** 조문마다 `pendingVersion`(시행본 유무와 무관한 최신 초안·검토중 버전, 없으면 null)을 더한다 — 시행본이 없는 조문은 화면이 이것을 "초안 · 시행 전"으로 보인다. 열람자에게는 보내지 않는다 (T-117) |
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
| PUT | :id/chapters/:chapterId/articles/:articleId | admin, editor | 조문 구조·메타 수정 — 번호(조·가지·항·목)를 바꿀 때 다른 조문의 **얼린 자리**(지난 계층 기록, T-110 ②)와 같으면 400(그 기간의 시점 조회에서 번호가 겹친다). 계층을 바꾸는 쓰기는 규정 행을 잠근다(장·절 생성·수정·삭제, 조문 생성·삭제도) |
| DELETE | :id/chapters/:chapterId/articles/:articleId | admin | 조문 삭제 |
| POST | :id/appendices | admin, editor | 부칙/별표/서식 생성 |
| PUT | :id/appendices/:appendixId | admin, editor | 부칙/별표/서식 수정 |
| DELETE | :id/appendices/:appendixId | admin | 부칙/별표/서식 삭제 |
| GET | :id/revision-reasons | admin, editor | **제정·개정 이유 목록** (문서 차수별 개정문) |
| POST | :id/revision-reasons | admin, editor | 제정·개정 이유 추가 |
| PUT | :id/revision-reasons/:reasonId | admin, editor | 제정·개정 이유 수정 |
| DELETE | :id/revision-reasons/:reasonId | admin, editor | 제정·개정 이유 삭제 |
| GET | :id/effective-dates | admin, editor | **시점 조회용** — 본문이 바뀐 시행일 목록(내림차순). 조문이 폐지돼 빠진 날(폐지 시행일)도 넣는다(T-126) |
| GET | :id/as-of | admin, editor | **시점 조회** — 기준일에 시행 중이던 본문. Query: `date`(YYYY-MM-DD) 고른 버전이 **얼린 계층**을 가지면 그때의 자리·조 제목·장·절로 조립한다(지운 장은 그때 번호·제목으로, 장의 조문이 모두 얼린 값이면 그때 장 번호·제목, T-110 ②). `asOf.repealedArticles` 의 번호도 그날 계층 |
| GET | :id/compare | admin, editor | **신구조문대비표** — 두 시점 본문을 조문 단위로 대비. Query: `from`, `to`(YYYY-MM-DD) 조문 표기도 그날 계층으로(T-110 ② — 삭제 행은 구조문 날짜의 번호) |
| GET | :id/compare-with | admin, editor | **규정 간 비교**(T-91) — 같은 기관의 **다른 규정**과 조문을 대조. Query: `targetId`. 게시본 기준(전문 보기와 같다). 공유 식별자가 없어 **조·항·목 번호로 맞대며**, 번호는 같은데 제목이 다른 줄은 `titleDiffers`·`summary.suspect` 로 표시한다. **두 규정 모두 테넌트 소속인지 각각 확인**한다(대상만 남의 것이어도 404) |
| POST | :id/export/pdf | admin, editor | **전문 PDF 내보내기.** Body는 전문 보기 렌더 HTML, 응답은 `application/pdf`. 동기 처리이며 감사 로그에 `policy.export.pdf` 로 남는다([ADR-0015](../10_ADR_의사결정기록/ADR.md)) |
| POST | :id/export/hwpx | JWT | **전문 한/글 내보내기.** Body는 같은 HTML, 응답은 `application/hwp+zip`. **`.hwp` 가 아니라 `.hwpx`** — `.hwp` 는 독점 바이너리라 서버에서 만들 수 없다([ADR-0016](../10_ADR_의사결정기록/ADR.md)). 한/글 2014 이상에서 열린다. 감사 로그 `policy.export.hwpx` |
| POST | :id/files | admin, editor | 첨부파일 업로드(≤50MB, PDF·Word·Excel·PNG·JPEG). 감사 `policy.file.upload` |
| GET | :id/files | JWT | 첨부파일 목록. `originalName`은 **올린 그대로의 이름**(한글 포함) |
| GET | :id/files/:filename | JWT | 첨부파일 다운로드. 한글 이름은 RFC 5987(`filename*=UTF-8''…`)로 실어 보낸다. **토큰은 `Authorization` 헤더로만 받는다** — 화면에서 `<a href>`로 바로 열면 401이다. 웹은 헤더를 실어 받아 브라우저 안에서 연다(T-120) |
| DELETE | :id/files/:filename | admin, editor | 첨부파일 삭제. 감사 `policy.file.delete`(details에 `fileName`) |

> **디스크 저장명과 표시 이름은 다르다.** 저장명은 `{시각}-{난수}-{base64url(원래이름)}{확장자}` 형태의 ASCII 안전 문자열이고([T-41](../15_보안검토서/보안_검토서.md)의 경로 탈출 방어가 저장명을 `[A-Za-z0-9._-]`로 제한한다), 표시용 `originalName`은 여기서 되돌려 만든다. `:filename` 자리에는 **저장명(목록의 `id`)** 을 넣는다. 이 형식 이전에 올라간 파일은 저장명이 그대로 표시된다(T-90).

> **첨부파일 4종 공통(T-41)**: 규정 소유를 먼저 확인하므로 남의 규정이면 404다. `:id`·`:filename` 은 형식 검사를 통과해야 하며(UUID / 저장 파일명), 조립 경로가 업로드 루트를 벗어나면 400. 예전에는 인코딩한 슬래시로 경로를 거슬러 올라가 컨테이너의 임의 파일을 읽고 지울 수 있었다.

| GET | :id/jo-order | JWT | 조 재정렬 시작점 — 현재 조 차례(`[{chapterId, jo, branch?}]`). 가지 조문(제3조의2)은 `branch` 를 단 별도 항목 (T-118) |
| PUT | :id/jo-order | admin·editor | 조 순서 일괄 재정렬·번호 재부여. Body: `order: [{chapterId, jo, branch?}]` — **규정의 모든 조를 문서 순서대로 한 번씩**. `jo`·`branch` 는 옮기기 전 번호. 재정렬하면 1부터 다시 매기므로 가지 번호는 풀린다(T-118). 빠지거나 겹치면 400. 조에 딸린 항·목 행도 함께 움직이고, 장이 바뀌면 절 지정은 풀린다(T-60) 바뀌는 조의 새 자리가 다른 조문의 얼린 자리와 같으면 400(T-110 ②) |

## versions (`/api/articles/:articleId/versions`, `/api/versions/:id`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | articles/:articleId/versions | admin, editor | 조문 버전 목록 — 버전마다 `_count.variableBindings`(그 버전 본문의 변수 연결 수, T-109) `structure`(발행 이력이면 얼린 계층, 초안·검토 중이면 재파싱 제안 계층)·`reparseItemId`·`reparseItem.reviewId`(재파싱 묶음의 버전, T-110 ②) |
| POST | articles/:articleId/versions | admin, editor | 초안(draft) 버전 생성 |
| GET | versions/:id | admin, editor | 버전 상세 |
| PUT | versions/:id | admin, editor | 초안 본문·변경메모 수정 |
| POST | versions/:id/submit | admin | 검토 요청 (draft→review) — 본문의 변수 표식(`{{KEY}}`, 등록된 변수만)을 **오늘(한국 날짜) 값**으로 바꿔 저장하고 그 자리를 연결로 남긴다(T-109). 값을 정할 수 없는 표식(값 없음·기간 겹침·기간 미확정)이 있으면 아무것도 바꾸지 않고 400(어느 표식이 왜) 재파싱 묶음의 버전(`reparseItemId`)이면 409 — 묶음으로만 처리한다(T-110 ②). 조문 행을 잠그고 상태를 다시 확인한다 |
| POST | versions/:id/approve | admin | 시행 승인 (review→published, 이전 published는 archived). **`effectiveDate` 확정 — 시점 조회의 기준**. 발행일 `publishedAt` 을 남기고(T-108), 개정 후보 승인과 같은 조문 잠금을 건다 — 같은 조문의 발행이 겹쳐 앞선 개정을 덮어쓰지 않게. **폐지한 조문을 다시 시행하면 시행일은 마지막 폐지일 이후**여야 한다(같은 날 가능 — 같은 날 시행분은 나중 버전이 이긴다, 아니면 400, T-126) **변수(T-109)**: 표식이 남은 본문은 400, 검토 요청 때 표식을 바꿔 넣은 값이 그 시행일에도 맞는 값인지 다시 보고 다르면 400(변수를 잠그고 읽는다), 앞 시행본의 변수 연결을 새 버전으로 옮긴다(차이로 위치 이동, 못 옮기면 "다시 이어야 함") 재파싱 묶음의 버전(`reparseItemId`)이면 409 — 묶음으로만 처리한다(T-110 ②). 조문 행을 잠그고 상태를 다시 확인한다 |
| POST | versions/:id/reject | admin | 검토 반려(review→draft). Body: `reason`(**필수**) — 사유는 버전의 `reviewNote` 에 남아 편집자에게 보인다. 다시 검토 요청하면 지워진다 (T-10) 재파싱 묶음의 버전(`reparseItemId`)이면 409 — 묶음으로만 처리한다(T-110 ②). 조문 행을 잠그고 상태를 다시 확인한다 |
| POST | versions/:id/archive | admin | 게시본 폐지(published→archived) — **오늘(한국 날짜)부터 조문을 시행에서 뺀다**: 폐지 시행일 `repealedOn` 을 남긴다(T-126). 날짜는 고르지 않는다(미래 폐지는 T-127 뒤, 소급 없음). 조문 행을 잠그고(승인과 같은 잠금) 다시 확인한다 — 그 사이 내려갔으면 409, 시행일이 없으면(보정 먼저)·아직 시행 전이면·오늘 뒤에 시행될 버전이 따로 있으면·오늘 시행 중인 본문이 이 버전이 아니면 400. 응답에 `repealedOn`·`remainingPublished` — 0이면 이 조문에 게시본이 없다(전문 보기·인쇄에 본문 없이 나온다) (T-10). 감사 `version.archive`(같은 트랜잭션, details `repealedOn`·`remainingPublished`) |
| GET | versions/diff | admin, editor | 두 버전 diff. Query: `v1`, `v2`(버전 ID) |
| POST | policies/:policyId/publish-drafts | admin | **시행본이 없는 조문(새로 넣은 조문, 폐지 뒤 다시 쓴 조문)의 초안을 한꺼번에 시행**(T-117). Body: `changeNote`(**필수**), `effectiveDate`(**필수**, YYYY-MM-DD — 이 조문들이 실제로 시행된 날. 오늘로 채우지 않는다(PAT-02), 없으면 400). 규정의 첫 시행이고 규정 시행일이 비어 있으면 같은 날로 채운다. 대상은 시행본이 없는 조문의 최신 초안·검토중 버전뿐이고, **이미 시행 중인 조문의 개정 초안은 건드리지 않는다**(그건 조문별 검토·승인). 응답 `{published}`. 감사 `version.bulk_publish` 1건, 개정 알림은 조문 수만큼이 아니라 1번("제1조 외 N건"). 폐지한 조문이 있으면 시행일이 그 폐지일 이후여야 한다 — 하나라도 어긋나면 400(조문·폐지일 목록)이고 아무것도 시행하지 않는다(T-126) 변수 표식이 남은 초안이 있으면 400(검토 요청으로 시행), 폐지 뒤 다시 시행하는 조문은 폐지한 버전의 변수 연결을 옮긴다(T-109) 재파싱 묶음의 초안은 빠진다(T-110 ②). 대상 조문을 id 순으로 잠그고 다시 확인한다 |
| POST | policies/:policyId/fill-effective-date | admin | **시행일 없이 시행된 버전에 확인한 시행일 넣기**(T-123 · PAT-02, 예전 가져오기 데이터 보정). Body: `effectiveDate`(YYYY-MM-DD, **필수** — 최초 제정일이 아니라 지금 본문이 시행된 날), `reason`(**필수**). 시행일이 비어 있는 시행본(published·archived)에만 넣고, 규정 단위 시행일이 비어 있으면 함께 채운다. **같은 조문의 앞뒤 시행본과 순서가 어긋나거나 비어 있는 시행본이 둘 이상인 조문이 하나라도 있으면 409 + `conflicts[]`(label·detail)로 아무것도 바꾸지 않는다.** 넣을 것이 없으면 400. 응답 `{updated}`. 감사 `version.effective_date_fill` |

## comments (`/api/articles/:articleId/comments`, `/api/comments/:id`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | articles/:articleId/comments | admin, editor, viewer | 조문 코멘트 목록 |
| POST | articles/:articleId/comments | admin, editor, viewer | 코멘트 작성 |
| PATCH | comments/:id | admin, editor | 처리완료/미처리 토글 |

## variables (`/api/variables`) — 변수 값·유효기간과 본문 위치 연결 (T-109 ①, 특허 도 9)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | variables | JWT | 변수 목록 — 값마다 유효기간(`validFrom`·`validTo`, 비면 처음부터·끝 없음)·`periodConfirmed`(false = 옛 기본값을 옮긴 기간 미확정 값)·`overlapping`(같은 변수의 다른 값과 기간 겹침), 오늘 쓸 값 `current`(없으면 `currentReason`: `none`·`ambiguous`(겹침)·`unconfirmed`), `needsReview`, `bindingCount`(지금 시행 중인 본문의 연결 수, 다시 이어야 하는 것 포함) |
| GET | variables/:id | JWT | 변수 하나 + 지금 시행 중인 본문의 연결 `bindings[]`(규정·조문 표기·버전·구간·문구·앞뒤 문맥·출현 순번·상태) |
| POST | variables | admin, editor | 변수 등록 `{ key, label, description?, value?, validFrom? }` — 첫 값은 시작일(비우면 처음부터)부터 끝 없이. 감사 `variable.create` |
| PUT | variables/:id | admin, editor | 표시명·설명 |
| DELETE | variables/:id | admin | 삭제 — 값·연결도 함께. 감사 `variable.delete` |
| POST | variables/:id/values | admin, editor | 값 추가 `{ value, validFrom?, validTo?, note? }` — 유효기간 [시작, 종료), 시작 ≥ 종료면 400. 기간이 겹쳐도 저장하고 `changedOverlaps: true` — 겹친 기간에는 값을 고르지 않는다. 변수 행을 잠근다(승인 때 값 재확인과 줄 세움). 감사 `variable.value.create` |
| PUT | variables/:id/values/:valueId | admin, editor | 값 고치기 `{ value?, validFrom?, validTo?, note?, confirmPeriod? }` — 기간을 넣거나 `confirmPeriod: true` 면 기간 미확정 값이 확정된다. 감사 `variable.value.update`(전후) |
| DELETE | variables/:id/values/:valueId | admin, editor | 값 지우기. 감사 `variable.value.delete` |
| GET | versions/:versionId/variable-bindings | JWT | 그 버전 본문의 연결(풀지 않은 것) — 다른 회사 버전은 404 |
| POST | versions/:versionId/variable-bindings | admin, editor | **시행 중인 버전의 문구를 변수에 잇기** `{ variableId, start, end, text }` — 위치는 저장된 본문의 UTF-16 [start, end). 시행본이 아니거나 `text` 가 본문 그 구간과 다르면(그 사이 바뀜) 409, 다른 연결과 겹치면 409, 앞뒤 공백이 있으면 400. 그 버전 시행일에 맞는 값과 같은 문구면 `valueId`(직전 적용값)를 적는다. 조문을 잠근다(발행 때 연결 옮기기와 줄 세움). 감사 `variable.binding.create` |
| DELETE | variable-bindings/:id | admin, editor | 연결 풀기 — 지우지 않고 `released` 로 남긴다. 감사 `variable.binding.release` |

> 예전 `POST variables/:id/usages`(버전-변수 사용 기록)와 `defaultValue` 는 없앴다(T-109) — 위치를 가진 연결과 기간 있는 값으로 대신한다. 마이그레이션 `20261009150000_variable_values_bindings` 가 옛 기본값을 기간 미확정 값으로, 옛 사용 기록을 표식 `{{KEY}}` 이 나오는 자리마다의 연결로 옮겼다(본문에 표식이 없던 기록은 "다시 이어야 함", 변수와 버전의 회사가 다른 기록은 옮기지 않음).

## search (`/api/search`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | JWT | 통합검색. Query: `q`(필수), `page`(기본 1), `limit`(기본 20) |
| GET | related-preview | JWT | 판·법·규 연관 미리보기. Query: `type`(precedent\|law\|rule, 필수), `q`(필수), `limit`(기본 5), `sort`(relevance\|latest), `scope`(title\|fulltext) |

## ask (`/api/ask`) — 규정 근거 AI 질의응답 (T-130, D-09) — 화면: `/ask`
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | status | JWT(전 역할) | `{configured, provider(anthropic\|mock\|null), enabled, used, limit}` — 서버에 AI 키가 있는지, 회사가 켜 두었는지, 이번 달(한국 시간) AI 를 부른 질문 수와 한도. 키는 내보내지 않는다 |
| POST | (root) | JWT(전 역할) | 규정에 대해 묻기. Body `question`(2~500자). **근거는 지금 시행 중인 본문뿐**(시점 조회 규칙과 같다 — 초안·미래 시행·폐지 조문은 후보가 아니다). ① 조 목차(규정명·조 제목)에서 AI 가 관련 조를 고르고 질문 낱말이 든 조를 더해 최대 12개 조 ② 그 본문만 참조 번호를 붙여 주고 답을 받는다 ③ 준 번호 밖의 근거는 버리고, 남는 근거가 없으면 답하지 않는다. 응답 `{answerable, reason?(no_regulations\|no_candidates\|no_basis\|refused), blocks[](paragraph·list·table), citations[](ref, articleId, policyId, policyTitle, label, joTitle, number, branchNumber, clauseNumber, itemNumber, content=DB 의 시행 중 본문), consulted[](살펴본 조), usage{used, limit}}`. 꺼져 있으면 403 `AI_QA_DISABLED`, 월 한도를 넘으면 429 `AI_QA_MONTHLY_LIMIT`, 서버 미설정 503, AI 호출 실패 502/503. 질문마다 `ai_qa_logs` 에 남는다 |
| PATCH | settings | admin | 회사의 규정 질문 켜기/끄기. Body `enabled`(bool). 바뀌면 감사 `ai_qa.settings_change`(details `{enabled}`) |

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
| GET | (root) | JWT | 알림 목록. `kind`: `policy_revision`(개정 시행 — `policyId` 로 규정 화면) / `law_amendment`(법령 개정으로 개정 후보가 생김, T-106 — `link` 로 법령 화면의 그 변경). `link` 는 규정이 아닌 화면으로 가는 알림의 이동 경로 |
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
| POST | upload | admin, editor | PDF 업로드 → 텍스트 추출(Python pdfplumber/pymupdf) → 조항 트리. 최대 30MB. 파싱에 성공하면 **원문 PDF를 세션 이름(`<세션id>.pdf`)으로 보관**해 `extractMeta.sourceFile` 에 적는다(등록 시 첨부로 옮김, 미등록은 일주일 뒤 정리). 한글 파일명은 latin1 해석을 바로잡아 `fileName` 에 저장 (T-120) |
| GET | :id | admin, editor, viewer | 파싱 세션 조회 |
| PATCH | :id/tree | admin, editor | 파싱 트리 수정. DTO에 `@Type(() => Object)` 필수 — 없으면 전역 ValidationPipe가 노드를 `[]`로 만든다(C-14) |
| POST | :id/commit | admin, editor | 파싱 결과 → 규정(Policy) 등록. 응답 `{policyId, sessionId, articleCount}`. 트리를 장·절·조·항·목으로 옮긴다(T-88·T-89). **원문 조·항·호 번호를 그대로 쓰고**(가지 조문은 `branchNumber`), 첫 조 앞의 글(문서 제목 등)은 조문이 아니라 규정 설명으로, 부칙·별표·서식은 규정 부칙·별표로 보낸다. 항·목은 제목 칸의 번호 표기를 버리고 문장을 본문으로 쓴다(예전 모양 세션의 제목 칸 문장도 살린다). 조문은 바로 시행 상태로 등록되고, 업로드한 원문 PDF는 규정 첨부파일로 붙는다 (T-115·T-118·T-120). Body 의 **`effectiveDate`(YYYY-MM-DD)는 필수**(T-123) — 가져오는 본문이 실제로 시행된 날이며 첫 버전과 규정 단위 시행일에 들어간다. 없거나 없는 날짜면 아무것도 만들지 않고 400 본문에 등록된 변수의 표식이 있으면 400(바로 시행하는 본문이라, T-109) |
| POST | :id/reparse | admin, editor | **기존 규정과 비교(T-110 ①, 재파싱)** `{ policyId }` — 이 원문을 고른 규정의 조문과 계층·내용 지문 두 축으로 맞춘 **재파싱 검토**를 만든다(201, 응답은 `GET /reparse-reviews/:id` 와 같다). 규정 데이터는 바꾸지 않는다. 같은 원문·같은 규정의 열린 검토는 지나간 것(`superseded`)이 되고 사람이 정한 결정은 같은 항목(종류·재파싱 행·기존 조문·후보가 같고 결정 규칙에 맞을 때)으로 옮겨 온다. 미리보기가 준비되지 않았거나 이미 새 규정으로 등록한 원문이면 400, 다른 회사의 원문·규정이면 404. 감사 `reparse.compare` |

## reparse-reviews — 재파싱 검토 (T-110 ①) — 화면: `/policies/:id/reparse/:reviewId`
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | /reparse-reviews/:id | admin, editor | 검토 1건 — `status`(open·superseded·applied), `algorithm`(`reparse/1`)·`normalizer`(`norm/1`), `summary`(종류별 개수 `counts`·장 단위 변경 `chapters`·부칙·별표 수(이번 비교에서 뺌)·작업본이 있는 조문 수), `undecided`(결정이 남은 항목 — 옮김·본문 바뀜·판정 보류·새 조문 후보), `stale`(비교한 뒤 규정이 바뀜 — 장·절·조문 계층·제목, 비교 대상 버전, 작업본), `sourceChanged`(비교한 뒤 원문 트리를 고침), `items[]` — `kind`(same 그대로·moved 옮김·changed 같은 자리 본문 바뀜·ambiguous 판정 보류·new 새 조문 후보·missing 원문에 없음), `articleId`, `parsed`(재파싱 행: 계층·장·절·제목·본문·지문·번호 다시 매김), `stored`(비교 대상: 최근 발행본(시행 예정 포함), 발행 이력이 없으면 최신 작업본 — 버전 id·번호·상태·시행/폐지일·본문·지문, 계층·장·절·제목, 작업본), `candidates`(판정 보류 후보), `reasons`(번호·본문·띄어쓰기만·상위 조·하위 항·앞뒤 조·빈 본문·번호 다시 매김·폐지·중복), `changes`(본문·띄어쓰기만·번호·장·절·제목), `recommended`, `decision`·`targetArticleId`·`decidedBy`·`decidedAt`, 본문 바뀜이면 낱말 단위 `diff`. 다른 회사 검토면 404 **2단계(T-110 ②)**: `status` 에 `applied`(반영 — 묶음 초안)·`submitted`(묶음 검토 요청)·`approved`·`rejected`, `plan`(승인 때 만들 장·절·새 조문, 장·절 번호·제목 변경, 버전 없는 조 머리 행 옮김, 폐지), 반영·검토 요청·승인·반려 시각과 사람, `effectiveDate`·`changeNote`·`rejectReason`, 항목마다 `outcome`(개정·자리 옮김·장 변경 초안, 새 조문, 폐지 예정·함·미결, 보류, 유지)과 `version`(그 항목의 묶음 버전). 반영·검토 요청 뒤의 `stale` 은 그때의 묶음 지문과 지금이 다름(그 단계로 넘어갈 수 없다) |
| PATCH | /reparse-reviews/:id/decisions | admin, editor | `{ items: [{ id, decision, targetArticleId? }] }` — 옮김: `accept`·`new`·`hold` / 본문 바뀜: `amend`·`new`·`hold` / 판정 보류: `pick`(후보 중, `targetArticleId`)·`new`·`hold` / 새 조문 후보: `new`·`link`(원문에 없는 기존 조문에 잇기)·`hold` / 원문에 없음: `keep`·`repeal`(관리자) 또는 `null`(미결). **한 기존 조문은 한 항목만** 가리킨다(400), 이어진 원문에 없는 조문은 유지·폐지를 정하지 않는다(400), 다른 검토의 항목 id 는 400, 지나간 검토면 409. 검토 행을 잠가 결정끼리 줄 세운다 옮김·본문 바뀜을 `new` 로 돌리면 그 기존 조문의 **원문에 없음 항목**을 곧바로 만들고(유지·폐지를 반영 전에 정한다), 되돌리면 거둔다(T-110 ②). 반영한 뒤에는 409 |
| POST | /reparse-reviews/:id/apply | admin, editor | **반영**(T-110 ②) — 결정이 모두 정해진 열린 검토만(아니면 400). 규정 → 조문(id 순) 잠금 아래 비교 때의 규정 상태·원문 트리를 다시 확인해 다르면 409. 기존 조문의 **묶음 초안**(본문·제안 계층, `reparseItemId`)만 만들고 지금 본문·계층은 그대로 둔다 — 새 조문·새 장·절은 계획에만(승인 때 만든다). 장·절 번호·제목이 바뀌면 그 장·절의 시행 중인 조문에 계층만 바꾸는 초안. 묶음이 아닌 초안·검토 중 버전이 남은 조문을 바꾸려 하면 409(그 항목을 보류로 두면 된다), 반영할 변경이 없으면 400. 원문은 다 쓴 것으로 둔다. 감사 `reparse.apply` |
| POST | /reparse-reviews/:id/submit | admin, editor | **묶음 검토 요청** — 반영한 묶음만. 반영 때의 묶음 지문(장·절·조문 계층, 발행 이력의 상태·시행일·폐지일·얼린 계층, 작업본, 계획)과 지금이 다르면 409. 묶음 초안을 한꺼번에 검토 중으로(변수 표식은 오늘 값으로). 감사 `reparse.submit` |
| POST | /reparse-reviews/:id/approve | **admin** | **묶음 승인** `{ effectiveDate, changeNote }` — 검토 요청한 묶음만, 같은 시행일로 전부 되거나 전부 안 된다. 묶음 지문(검토 요청 뒤엔 묶음 본문까지)이 다르면 409, 그 조문에 더 늦은 시행본이 있으면 409, 폐지 뒤 다시 시행이면 폐지일 이후, 변수 표식·값 확인, **승인 시행일부터 그 뒤의 모든 시행일에서 같은 자리에 시행 중인 조문이 둘이 되면 409**. 시행일이 미래인데 폐지로 정한 조문이 번호·제목이 바뀌는 장·절에 있으면 409. 통과하면: 계층이 바뀌는 조문의 발행 이력을 그때 계층으로 얼리고, 장·절을 만들거나 고치고, 묶음 버전을 후속 버전으로 발행(제안 계층을 조문 행에, 변수 연결 이어받기), 버전 없는 조 머리 행을 옮기고, 새 조문(첫 버전 그 시행일)을 만들고, 시행일이 오늘 이전이면 폐지로 정한 조문을 그 날로 폐지(미래면 미결). 감사 `reparse.approve`, 개정 알림 한 번 |
| POST | /reparse-reviews/:id/reject | **admin** | **묶음 반려** `{ reason }` — 반영했거나 검토 요청한 묶음만. 묶음 초안을 거두고(새 조문·장은 아직 없다) 원문을 다시 비교할 수 있게 돌려 둔다 — 같은 원문으로 다시 비교하면 반려한 검토의 결정을 옮겨 온다. 감사 `reparse.reject` |
| POST | /reparse-reviews/:id/items/:itemId/resolve | admin, editor | 승인·반려 뒤 원문에 없는 조문 `{ decision: keep \| repeal }` — 유지로 닫거나 오늘 폐지(관리자, T-126 절차 그대로). 승인 전이면 409, 이미 폐지했으면 409, 원문에 없음 항목이 아니면 400 |
| GET | /policies/:policyId/reparse-reviews | admin, editor | 이 규정의 재파싱 검토 최근 20건 — `status`·`sourceName`·`counts`·`undecided`·`deletionUndecided`(원문에 없는데 유지·폐지를 정하지 않았고 다른 항목에 이어지지도 않은 조문) |

## admin (`/api/admin`)

> 관리자(`admin`) 전용. 규정 가져오기 화면의 **JSON 일괄 등록** 탭에서 쓴다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | import/policies/validate | admin | **사전 검사**(200). 넣지 않고 문제를 전부 모아 돌려준다. 응답 `{issues[], canImport, summary}` (T-13) |
| POST | import/policies | admin | 일괄 등록. 한 트랜잭션 — 하나라도 걸리면 전부 무산된다. 검사에 걸리면 400 + `issues`. 규정마다 `effectiveDate`(YYYY-MM-DD) — `publish: true` 조문이 하나라도 있으면 **필수**이고 그 시행본과 규정 단위 시행일에 들어간다(T-123, "오늘"로 채우지 않는다) 바로 시행(`publish: true`)하는 조문에 변수 표식이 남아 있으면 400 — 초안으로 가져와 검토를 요청한다(T-109) |

> **사전 검사가 보는 것**: 코드 중복(기존/파일 안), 빈 코드·제목, 길이 초과, 장·조 번호 형식 → 오류. 장 없음, 빈 본문, 조 번호 겹침·건너뜀 → 경고. **플랜 규정 상한**도 여기서 본다 — 예전에는 일괄 가져오기가 상한을 통과해 Starter(5건)가 한 번에 100건을 넣을 수 있었다.

## audit (`/api/audit-logs`)

> 관리자(`admin`) 전용. 감사 로그에는 다른 구성원의 활동이 함께 담긴다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin | 목록. Query: `action`(정확히 일치 / 끝에 `.` 이면 접두어 묶음), `userId`, `from`·`to`(YYYY-MM-DD, **한국 날짜 기준·종료일 당일 포함** — 한국 그날 0시 이상 ~ 다음 날 0시 미만, T-129. 없는 날짜는 거르지 않는다), `page`, `limit`(기본 50, 최대 200). 응답 `{rows, total, page, limit}`. **`rows` 에는 `details` 본문이 없다** — `hasDetails`·`keys` 만 (T-11) |
| GET | actions | admin | 이 회사에 쌓인 액션 종류·건수 (필터 드롭다운용) |
| GET | actors | admin | 기록을 남긴 적 있는 사용자 목록 (필터용) |
| GET | :id | admin | 기록 상세 — `details` 본문 포함 |

> **목록에서 `details` 를 뺀 이유**: 템플릿 수정 기록의 `details` 에는 before/after 스냅샷(레이아웃 JSON + CSS 전문)이 들어 있어, 50건이면 응답이 수 MB 가 된다. 목록에서는 펼치기 전까지 쓰지 않는다.

## billing (`/api/billing`)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | checkout | admin | 플랜 업그레이드 체크아웃. **결제 미사용 서버(`PAYMENT_PROVIDER` 미설정 — 운영 기본)는 403 `BILLING_CLOSED`** 이고 요금제·구독·결제 기록을 바꾸지 않는다(가격 확정 전 임시 운영 방침, T-125 — 요금제 변경은 `PATCH /platform-admin/tenants/:tenantId/plan`). `mock`(명시해야 켜짐)은 즉시 반영, 실 PG 는 결제창 주소만 돌려준다. 반영 시 **구독·결제 기록을 남기고** `tenant.planExpiresAt` 을 구독 종료일로 채운다 (T-17) |
| GET | history | admin | 결제·구독 이력. 응답 `{currentSubscription, subscriptions[], payments[]}` |
| POST | webhook | Public | 결제 프로바이더 웹훅 수신. **실결제 프로바이더 + `PAYMENT_WEBHOOK_SECRET` 설정 + 헤더 `x-billing-secret` 일치일 때만** 받는다 — 결제 미사용·mock 403 `PAYMENT_DISABLED`, 비밀키 미설정 403 `WEBHOOK_SECRET_NOT_CONFIGURED`, 불일치 401 `INVALID_WEBHOOK_SECRET`(본문을 보기 전에 판단, T-125). `data.amount`·`data.orderId` 를 결제 기록에 남긴다 |

> **mock 결제는 0원으로 기록된다** — 실제로 돈이 오가지 않으므로 요금표를 지어내 넣지 않는다(`metadata.mock: true`). 실 PG 를 붙이면 결제사가 알려 준 금액을 쓴다(요금 정책은 D-03).
> **구독 전이**: 같은 요금제를 다시 사면 기존 구독을 **연장**(이력이 쪼개지지 않게), 요금제가 바뀌면 이전 구독을 `canceled` 로 닫고 새로 연다(활성 구독은 항상 1개).
> **결제 미사용이 기본(T-125, [ADR-0022](../10_ADR_의사결정기록/ADR.md))**: 2026-10-08 전에는 `PAYMENT_PROVIDER` 가 비어 있으면 `mock` 이라, 이 값을 넘기지 않던 운영에서 고객사 관리자가 결제 없이 요금제를 올릴 수 있었다. 웹훅도 비밀키가 없으면 검사를 건너뛰었다(요금제가 안 바뀐 건 아래 DTO 의 `data` 가 검증에서 통째로 거부됐기 때문).

## platform-admin (`/api/platform-admin`) — `global_admin` 전용
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | tenants | global_admin | **고객사 개설 + 마스터 계정 발급**(T-122). 회사명·조직 코드(영문 소문자·숫자·하이픈 2~40, 하이픈 시작 불가)·플랜(기본 starter)·마스터 이메일·이름. 마스터 비밀번호는 받지 않는다 — 서버가 임시 비밀번호(헷갈리는 글자 뺀 14자)를 만들어 **응답에 한 번만** 싣는다(저장·감사 기록 없음). 마스터는 첫 로그인 때 바꿔야 한다. 조직 코드 중복 409. 감사 `platform_admin.tenant.create`. 서버에서는 `scripts/oracle/create-tenant.sh` 가 같은 코드를 부른다 |
| GET | tenants | global_admin | 테넌트 목록 |
| GET | tenants/:tenantId/users | global_admin | 테넌트 사용자 목록 |
| PATCH | tenants/:tenantId/plan | global_admin | 테넌트 플랜 변경. **가격 확정 전에는 요금제를 바꾸는 유일한 경로**(T-125). 결제가 아니므로 결제·구독 기록은 만들지 않고 감사 로그 `platform_admin.tenant_plan.update` 를 남긴다. 다음 요청부터 반영(다시 로그인 불필요) |
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

## 법령 개정 연계 (2026-09-21 신설)

> `laws`·`law-links`·`law-sync` 절과 `law-changes` 의 조회·영향 분석, `amendments` 전부(생성·조회·목록·손질·검토 요청·승인·반려)는 **구현됐다**(T-100·T-101·T-104~T-108).
> 나머지(`law-changes` 수동 등록)는 아직 **설계**다 — 이 문서의 다른 절이 실제 컨트롤러를 옮긴 것인 반면 그쪽만 계획이다.
> 근거는 특허 명세서 `26PD0271KR`이고 상세는 [18_법령개정연계_설계 6절](../18_법령개정연계_설계/법령개정연계_설계안.md),
> 요구사항은 [03_SRS 12절 REQ-LAW](../03_SRS_요구사항명세/SRS_요구사항명세.md), 작업은 [17_작업관리대장 S7](../17_작업관리대장/작업관리대장.md).

### laws (`/api/laws`) — 법령, **테넌트 공용** ✅ 구현됨 (T-100)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | 로그인 | 등록된 법령 목록. `lastCheckedAt`·`lastCheckError`·`articleCount` 포함 — **언제 확인한 것인지, 확인에 실패했는지 화면에서 보여야 한다**(`lastCheckError` 가 있으면 "개정 없음"이 아니라 "확인 못 함") |
| POST | (root) | admin·editor | 법제처 MST로 법령 등록(추적 시작). 조·항·호를 `LawArticle` 로 저장. **200** |
| GET | :id | 로그인 | 법령 1건 |
| GET | :id/articles | 로그인 | 법령조항 목록 (원문 순서). 법령에서 사라진 조항(`deletedAt`, T-124)은 빠진다 — 목록·`articleCount` 모두 |
| DELETE | :id | admin·editor | 추적 해제 |

`POST /api/laws` 본문: `{ "mst": "283457", "sourceCode": "law.go.kr" }` (`sourceCode` 생략 가능).
응답에 `articleCount`·`skipped`(조 번호를 못 읽어 건너뛴 행 수)·`versionKey` 가 실린다.

**같은 MST 를 다시 POST 하면 `nodeKey` 기준으로 갱신한다** (T-101 착수 시 정정 — 원래는
통째로 갈아끼웠다). 내용이 그대로면 `versionKey` 도 그대로고, **`LawArticle.id` 도 유지된다**
— `LawLink`(T-101)가 이 id 를 참조하므로, id 가 재등록마다 바뀌면 만들어 둔 연결이 전부
끊긴다. 새 응답에 없는 `nodeKey` 는 지운다(조문이 실제로 삭제된 개정).

재등록 때 조항별 `versionKey` 를 직전 값과 비교해 **신설·변경·삭제된 조항을 `LawChangeEvent` 로 남긴다**
(T-103). 공백만 다른 조항은 지문이 같아 남지 않고, **최초 등록은 이벤트를 만들지 않는다**(비교할 이전
상태가 없다). 응답 형식은 그대로다 — 이벤트는 아래 `law-changes` 로 조회하게 될 예정이다.

> 법령 데이터에는 `tenantId` 가 없다(모든 고객사가 같은 법을 본다 — [ADR-0020](../10_ADR_의사결정기록/ADR.md)).
> 조회는 로그인만 하면 열리고, **쓰기는 admin·editor 로 제한**한다 — 등록이 법제처 외부 호출을
> 일으키고 호출량이 인증값 단위로 제한되기 때문이다. 한 테넌트가 등록한 법령을 다른 테넌트도 쓴다.
>
> `DELETE` 는 **연결(`LawLink`)이 남아 있으면 409** (T-101 에서 구현). 테넌트 무관하게 하나라도
> 있으면 막는다 — 법령은 공용이라 다른 테넌트의 연결도 함께 봐야 한다. **이 법령의 개정으로 만든
> 개정 후보가 있어도 409**(T-106, 회사·상태 무관) — 법령을 지우면 변경 이벤트가 함께 지워져 후보·승인
> 이력의 원천이 사라진다(이벤트 FK 도 `Restrict`).

### law-links (`/api/law-links`) — 법령 관계 정보, ⚠️ **테넌트별** ✅ 구현됨 (T-101)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | `?articleId=` | admin·editor | 이 **사내 조문**에 걸린 법령조항. 법령에서 사라진 조항에 걸린 연결도 남아 있고 `lawArticle.deletedAt` 으로 알 수 있다(T-124) |
| GET | `?lawArticleId=` | admin·editor | 이 **법령조항**에 걸린 *우리 회사* 조문. ⚠️ `LawArticle` 에 `tenantId` 가 없으므로 **여기서 경계를 건다** |
| POST | (root) | admin·editor | 연결 생성(수동). 관계 유형·적용 범위·근거 문구. 법령에서 사라진 조항이면 409(T-124) |
| POST | suggest | admin·editor | 본문 인용 패턴으로 자동 추천 → `confirmState=suggested` 로 생성. 법령에서 사라진 조항은 추천하지 않는다(T-124) |
| PATCH | :id | admin·editor | 확정/반려/관계 유형 수정 |
| DELETE | :id | admin·editor | |

### law-changes (`/api/law-changes`) — 변경 이벤트 · 영향 분석 ✅ 조회 구현됨 (T-105)
> 저장은 T-103(재등록)·T-104(주기 동기화)가 한다. 이벤트 자체는 모든 회사가 함께 쓰는 데이터지만,
> **영향(어느 조문이 걸리나)은 `LawLink.tenantId` 로 자기 회사 것만** 센다 — 법령조항에서 출발하는 조회의 유일한 경계다.

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin·editor | 변경 이벤트 목록(최근 순, `lawId`·`affected`·`limit` 필터). 각 행에 `label`(조문이 사라진 이벤트도 nodeKey 로 되살린 표기)과 `impact: { confirmed, suggested }` — **우리 회사** 연결 수. `affected=true` 면 확정 영향이 있는 이벤트만 |
| GET | :id/impact | admin·editor | **이 변경이 걸리는 우리 회사 조문.** 확정(`confirmed`) 연결만 — 추천은 `suggestedCount` 로만. 조문마다 정책·관계 유형·근거 문구와 **제1 조문**(`baseVersion` — 기준일에 시행 중인 발행 버전, 규정 시점 조회와 같은 규칙). 기준일(`asOf`, 생략 시 **법령 시행일과 오늘 중 늦은 날**)에 시행 중인 버전이 없으면 빼지 않고 `baseVersion: null` 과 이유 `skipReason` — `effective_date_missing`(시행본은 있는데 시행일이 기록되지 않음 — T-123 이전에 가져온 규정, 규정 화면에서 보정하면 풀린다) / `not_in_force`(기준일에 시행 중인 본문 없음) / `repealed`(기준일에 폐지돼 있음 — 폐지 시행일 `repealedOn` 을 함께, T-126). 조문마다 이 변경으로 만든 **개정 후보** `candidate`(T-106 — 지금 기준 본문으로 만든 것, 없으면 가장 최근 것과 `isCurrentBase: false`, 없으면 `null`). 법령에서 조문이 통째로 사라져 연결도 함께 지워진 이벤트는 `unresolvable` 에 사유 |
| POST | (root) | admin·editor | 수동 등록 (`receivedVia=manual`) — **아직 설계** |

### law-sync (`/api/platform-admin/law-sync`) — 주기 동기화, `global_admin` 전용 ✅ 구현됨 (T-104)
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | run | global_admin | **지금 실행.** 확인이 오래된 법령부터 `limit` 건(기본 20, 1~100). 법령마다 법령ID 로 지금 판의 MST 를 찾아, 저장된 MST 와 다르면 새 판을 받아 조항을 갱신하고 달라진 조항을 `LawChangeEvent`(`receivedVia=poll`)로 남긴다. 다른 실행이 진행 중이면 **409**(30분 넘게 끝나지 않은 실행은 "중단됨"으로 닫고 진행). 응답은 실행 기록 1건 + `amendments`(T-106 — 끝에 붙은 개정 후보 자동 생성 결과 `{ events, tenants, created, failed }`, 생성이 통째로 실패하면 `null`) |
| GET | runs | global_admin | 실행 이력(최근 순, `limit` 기본 20). `status`: succeeded / partial / failed / running, 법령별 `results[]`(`outcome`: unchanged·updated·failed, `fromMst`·`toMst`·`events`·`error`) |

> **동기화가 끝나면 개정 후보를 자동으로 만든다**(T-106). 아직 처리하지 않은 변경 이벤트(`amendmentsProcessedAt` 이 비어 있음)마다 확정 연결이 있는 회사별로 `POST /amendments/generate` 와 같은 생성을 하고, 새로 만든 후보가 있으면 그 회사의 관리자·편집자에게 알림(`kind=law_amendment`) 한 건. 한 회사가 실패해도 다른 회사는 진행하고, 실패가 있었던 이벤트는 표시를 남기지 않아 다음 실행에서 다시 처리한다(이미 만든 후보는 건너뛰므로 알림도 다시 가지 않는다). 수동 등록(`POST /laws`)으로 생긴 이벤트는 다음 동기화 때 처리된다.
> **예약 실행은 이 API 가 아니다.** 서버 cron 이 `scripts/oracle/law-sync.sh`(→ 컨테이너 안 `node dist/laws/law-sync.cli.js [--limit N]`)를 부르고, 하나라도 실패하면 **종료 코드 1**. global_admin 토큰은 15분이면 만료돼 cron 이 쥘 수 없다. 경로가 `/admin` 이 아닌 것은 그쪽이 회사 관리자 전용이라서다.
> **실패를 "개정 없음"과 구별한다** — 법제처는 인증·IP 오류도 HTTP 200 으로 준다. 실패한 법령은 `Law.lastCheckError` 에 사유가 남고 다음 확인이 성공하면 지워진다.

### amendments (`/api/amendments`) — 개정 후보, ⚠️ **테넌트별** ✅ 생성·조회(T-106)·목록·손질·검토 요청(T-107)·승인·반려(T-108) 구현됨
| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | (root) | admin·editor | 후보 목록 `{ rows, total, page, limit }` (최근 순). `state`: `open`(기본 — 처리할 것 = 작성·검토)·`draft`·`review`·`approved`·`rejected`·`all`, `policyId`, `policyActive`(`active`/`inactive`, 생략하면 모두 — 비활성 규정의 후보도 숨기지 않는다), `changeEventId`, `page`, `limit`(1~100, 기본 30). 행마다 규정·조문·법령 변경·`current`(지금 판 기준: `revision`·`hasChanges`(공백 말고 기준 본문과 다른가)·`unexplained`·`edited`)·`isCurrentBase`(지금 다시 만들면 고를 기준 본문이 이 후보의 제1 조문과 같은가 — 시점 조회와 같은 규칙)·`staleReason`(낡은 까닭 — `repealed`(기준일에 조문이 폐지됨, T-126)·`base_changed`(그 사이 개정됨)·`history_changed`(기준 본문은 같아도 발행 이력이 바뀜, T-108)·`variable_changed`(예정 사내 시행일로 다시 고르면 넣을 변수 값이 달라짐, T-109 ②))·`createdBy`(null 이면 자동 생성)·`plannedEffectiveDate`(T-109 ②) |
| GET | :id | admin·editor | 후보 1건 — 제1 조문(`baseVersion`)·후보 본문(`candidateContent`)·**변경 근거**(`rationale`: 법령 변경 부분 `lawChanges`, 연결 스냅샷 `link`, 경로 `path`, 적용 규칙 `applications`, 반영하지 못한 변경 `unmapped`, 충돌 `conflicts`)·**변경 전후 비교**(`diff`: 표시용 `parts`, 문자 구간 `changes[]` 과 각 구간의 근거 `rationaleRefs`, 근거 없는 구간 수 `unexplained`)·생성 정보(`generationMeta`: 규칙·템플릿과 버전, 신뢰도 판정, 입력 원천)·`confidence`(high·medium·low, **생성 때 값으로 고정**)·`reviewFlags`(생성 때 값)·`current`(지금 판 기준 표시)·`reviewState`·`revision`·`lockVersion`·`asOf`·`event`·`policy`·`article`·`isCurrentBase`·`staleReason`(목록과 같다)·`currentBase`(기준 본문이 그 사이 바뀌었으면 지금 기준 본문 — 조문이 폐지됐으면 null)·`reviewRequest`(검토 중이면 요청 — 대상 판·사유·요청자·시각)·`siblings`(같은 변경·조문의 다른 후보)·`plannedEffectiveDate`·`rationale.variables`(변수 근거)·`diff.changes[].variableRefs`(T-109 ②). 다른 회사 후보는 **404** |
| GET | :id/history | admin·editor | 판(`revisions[]` — 생성본 판 1 부터, 판마다 본문·해시·수정 사유·고친 사람·고치기 전 상태·**직전 판 대비** `fromPrevious`)과 상태 전환(`stateChanges[]` — 검토 요청·손질로 인한 요청 취소, 판 번호·사유·누가) (T-107) |
| POST | generate | admin·editor | 변경 이벤트로 **우리 회사** 영향 조문마다 후보를 만든다(규칙 기반, **확정된 관계만**, 영향 판정은 `law-changes/:id/impact` 와 같다). **200** `{ changeEventId, asOf, created[], existing[], skipped[{articleId, policyId, label, reason(`effective_date_missing`·`not_in_force`·`repealed`)}], noSubstantiveChange, unresolvable }` — 같은 이벤트·조문·기준 발행본·생성 방식·개정안의 후보가 이미 있으면 다시 만들지 않고 `existing` 으로 돌려준다(사람이 손댄 후보를 덮지 않는다, 감사 기록도 새로 남기지 않는다). 연혁 표기만 바뀐 개정은 `noSubstantiveChange: true`. 만들면 감사 `amendment.generate`(같은 트랜잭션). **변수 값(T-109 ②)**: `plannedEffectiveDate?`(예정 사내 시행일 — 변수 값을 고르는 날, 생략하면 기준일, 응답에도). 영향 조문이면서 기준 본문에 변수가 연결된 자리에 그 날 값을 넣는다 — 같은 값이면 그대로, 값을 정할 수 없으면(값 없음·기간 겹침·기간 미확정·문구 불일치) 넣지 않고 `variable_unresolved`, 법령 고침과 같은 자리면 원문을 두고 양쪽 제안(`variable_conflict`, 그 법령 변경은 반영하지 못한 변경). 근거는 `rationale.variables`(연결·고른 값·유효기간·범위·위치 전후·상태·까닭), 비교 정보 구간마다 `variableRefs`(법령 `rationaleRefs` 와 따로). 규칙 세트 `rule/2`. 후보 중복 판정에 예정일·변수 입력 지문이 들어간다. 감사 `amendment.generate` 에 후보별 변수 선택 |
| PATCH | :id | admin·editor | **손질 — 새 판**(T-107). `{ candidateContent, note, expectedRevision, expectedLockVersion }` — 수정 사유 필수(빈칸 400), 바뀐 것이 없으면 400, 화면이 본 판·잠금 버전이 지금과 다르면 **409**(`{ message, revision, lockVersion }` — 그 사이 누가 고쳤거나 검토를 요청했다). 비교 정보를 다시 만들어 규칙이 낸 문구가 그 자리에 그대로 남은 곳만 규칙 근거로 잇고, 사람이 고친 곳은 근거 없는 변경(검토 대상)으로 남긴다. 검토 중(반려된) 후보를 고치면 **작성으로 되돌린다** — 새 판으로 다시 검토를 요청해야 한다(요청 기록은 이력에 남는다). 승인된 후보는 400. 감사 `amendment.edit`(판 번호·전후 본문 해시·사유, 본문 자체는 판 테이블에만). 응답은 `GET :id` 와 같다 |
| POST | :id/review | admin·editor | **검토 요청**(작성 → 검토, T-107). `{ expectedRevision, expectedLockVersion, reason? }` — 검토 대상 판을 기록한다. 본문이 기준 본문과 (공백 말고) 다르지 않으면 "개정 불필요" 판단이라 `reason` 필수(400). 작성 상태가 아니면 400, 판·잠금이 다르면 409. 기준 본문이 그 사이 바뀌었어도 막지 않는다(화면이 경고, 승인 때 T-108 이 다시 확인). 감사 `amendment.request_review`(요청 id·판·해시·사유) |
| POST | :id/regenerate | admin·editor | **다시 만들기**(T-107) — 같은 변경·**그 조문만** 지금 기준 본문으로 후보를 만든다. `{ asOf? }`(T-108) — 승인하려던 시행일을 주면 그 날 시행 중인 본문이 기준 본문이 된다(409 `base_mismatch`·`history_changed` 뒤에 쓴다). 같은 기준 본문·발행 이력이면 있던 후보를 돌려준다. 옛 후보는 그대로(사람이 고친 것을 옮기지 않는다). `{ candidateId, created, unchanged(기준 본문이 그대로라 같은 후보), skipped, noSubstantiveChange, unresolvable }`. **예정 사내 시행일**(T-109 ②): `{ plannedEffectiveDate? }` — 생략하면 asOf 와 같은 날(승인하려던 시행일의 변수 값). 기준 본문이 같아도 고른 값이 다르면 새 후보 |
| POST | :id/approve | **admin** | **승인 → 후속 버전 발행**(T-108). `{ effectiveDate, changeNote, earlyReason?, expectedRevision, expectedLockVersion }`. 검토 중인 후보·검토를 요청한 **그 판**만(아니면 400/409). 사내 규정 시행일 필수·**소급 불가**(오늘 이후, 아니면 400), 법령 시행일보다 이르면 `earlyReason` 필수(400). 본문이 기준 본문과 (공백 말고) 같으면 400(개정 불필요는 반려). **조문 행을 잠그고** 다시 확인해 어긋나면 **409 `{ message, reason }`** — `undated_history`(시행일 미기록 시행본) · `repealed`(그 시행일에 조문이 폐지돼 있음 — 반려로 닫는다, T-126) · `base_mismatch`(그 시행일의 시행본이 기준 본문이 아님) · `later_version`(그보다 늦은 시행본) · `history_changed`(후보를 만든 뒤 다른 발행·폐지·시행일 보정 — 발행 이력 지문). 통과하면 한 트랜잭션: 같은 조문(**조문 식별자 유지**)의 후속 버전(번호 = 가장 큰 번호 + 1, `published`, 시행일, 개정 사유, 발행일 `publishedAt`, `changeEventId`, `sourceCandidateId`) 생성 · 옛 시행본은 내려감(archived, 폐지 시행일 없음) · 후보 `approved` · 상태 전환 기록 · 감사 `amendment.approve`(5요소 + 개정 당시 근거) · 알림(검토 요청자·후보 생성자에게 결과, 규정에 지정한 개정 알림 수신자에게 개정 시행 — 시행일이 미래면 "발행 · 시행 예정", 승인한 사람은 빼고 한 사람에 한 건). **같은 요청을 다시 보내면**(같은 판·시행일·사유) 새로 발행하지 않고 `alreadyApproved: true` 로 결과를 돌려준다 — 다른 시행일·사유면 409. 응답은 `GET :id` 와 같다(`decision`·`resultVersion` 포함). 후보 본문에 변수 표식이 남아 있으면 400, 기준 본문의 변수 연결을 새 버전으로 옮긴다(T-109). **변수 값(T-109 ②)**: 승인하는 시행일에 다시 골라 후보가 넣은 값과 다르면(값·유효기간·연결이 바뀜, 다른 날로 승인, 변수 반영 전 `rule/1` 후보에 넣을 값이 생김) 409 `variable_changed` — 그 시행일로 다시 만들면 그 날 값의 새 후보. 법령 고침과 겹쳐 원문을 둔 자리는 비교하지 않는다. 변수를 공유 잠금으로 읽어 값 고치기와 줄 세운다. 발행 때 값을 넣은 자리의 연결은 새 값으로 잇는다(앞뒤가 그대로인 자리). 감사 `amendment.approve` 에 `plannedEffectiveDate`·`variables` |
| POST | :id/reject | **admin** | **반려**(T-108). `{ reason, expectedRevision, expectedLockVersion }` — 검토 중인 후보만, 사유 필수(빈칸 400), 판·잠금이 다르면 409. 발행본은 그대로. 상태 전환 기록(반려자·시각·대상 판·사유)·감사 `amendment.reject`·알림(요청자·생성자). 반려된 후보를 고치면 작성으로 돌아간다 |

> **viewer 에게는 열지 않는다.** 개정 초안은 확정 전 내부 문서다.
> 후보는 **발행 버전을 바꾸지 않는다** — 시점 조회·전문·인쇄에 나오지 않고 승인(T-108) 때에만 후속 버전이 된다.
> 규칙으로 고칠 근거가 확실하지 않으면 본문은 제1 조문 그대로이고 `reviewFlags` 에 `manual_draft_required`(그 밖에 `ambiguous_match`·`context_unclear`·`rule_conflict`·`relation_review_only`·`scope_review`·`law_provision_repealed`·`unexplained_change`·`unmapped_law_change`).
> `approve` 는 **사람의 승인을 요구하는 것이 제품 요구사항이자 특허 청구항의 구성요소**다 — 자동 발행 경로를 만들지 않는다([ADR-0021](../10_ADR_의사결정기록/ADR.md)).

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
**UpdateMyProfileDto** — `name`(문자열, trim, 1~100자)
**ChangePasswordDto** — `currentPassword`(비어 있지 않은 문자열), `newPassword`(문자열 — 길이·바이트·"현재와 같음" 검사는 서비스의 `passwordProblem` 이 한국어 문구로 400)
**ResetPasswordDto** — `newPassword`

## law-changes
**LawChangeListQueryDto** — `lawId?`, `affected?`(`true`/`1` 만 참 — 쿼리 문자열 `"false"` 를 참으로 바꾸는 암묵 변환을 피한다), `limit?`(1~100, 기본 50)
**LawImpactQueryDto** — `asOf?`(YYYY-MM-DD, 실제로 있는 날짜)
**GenerateAmendmentsDto**(amendments.generate) — `changeEventId`(uuid), `asOf?`(YYYY-MM-DD, 실제로 있는 날짜 — 이날 시행 중인 본문이 제1 조문, 생략하면 법령 시행일과 오늘 중 늦은 날)
**AmendmentListQueryDto**(amendments 목록) — `state?`(open·draft·review·approved·rejected·all, 기본 open), `policyId?`(uuid), `policyActive?`(active·inactive), `changeEventId?`(uuid), `page?`(≥1), `limit?`(1~100, 기본 30)
**EditAmendmentDto**(amendments 손질) — `candidateContent`(1~20000자), `note`(수정 사유, ≤500, 공백만이면 400), `expectedRevision`(≥1), `expectedLockVersion`(≥0)
**ApproveAmendmentDto**(amendments 승인) — `effectiveDate`(YYYY-MM-DD, 필수·기본값 없음), `changeNote`(≤500, 필수), `earlyReason?`(≤500 — 법령 시행일보다 이른 시행이면 필수), `expectedRevision`, `expectedLockVersion`
**RejectAmendmentDto**(amendments 반려) — `reason`(≤1000, 필수), `expectedRevision`, `expectedLockVersion`
**RegenerateAmendmentDto**(amendments 다시 만들기) — `asOf?`(YYYY-MM-DD)
**RequestReviewDto**(amendments 검토 요청) — `expectedRevision`, `expectedLockVersion`, `reason?`(≤500 — 본문이 기준 본문과 같으면 필수)
**UpdateUserDto** — `name?`(trim, 1~100자), `email?`(이메일, 자동 trim+소문자), `role?`(admin|editor|viewer). 하나도 보내지 않으면 400. `null` 도 400 — `@IsOptional` 은 `null` 을 "없음"으로 통과시켜 필수 컬럼에 `null` 이 흘러가므로 `@ValidateIf(!== undefined)` 를 썼다

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
- 그 시점에 폐지돼 있던 조문은 그 시점 스냅샷에서 빠지므로 `removed` 로 나온다(T-126).
- `from > to`면 400.

### 시점 조회(as-of) 응답 규칙
- 조문별로 **시행일 ≤ 기준일인 `published`/`archived` 버전 중 가장 나중** 것을 고른다.
- 기준일에 아직 시행되지 않은 조문은 응답에서 **제외**한다(그날 존재하지 않던 조문).
- 고른 버전의 폐지 시행일(`repealedOn`)이 기준일 이하면 그 조문도 **제외**한다 — 옛 버전으로 되살리지 않는다. 대신 `asOf.repealedArticles[]`(`id`·번호·`title`·`repealedOn`)로 따로 알린다(T-126). 폐지 뒤 다시 시행한 버전은 시행일이 폐지일 이후라 그 날부터 나온다.
- 응답은 `GET :id`와 같은 형태 + `asOf: { date, omittedArticles, repealedArticles, hasEffectiveDates }`. 전문 보기·인쇄·PDF가 그대로 재사용한다.

## versions
**CreateVersionDto** — `content`(문자열), `changeNote?`
**UpdateVersionDto** — `content?`, `changeNote?`
**ApproveVersionDto** — `changeNote`(필수, 최소 1자 — "개정 사유를 입력하세요"), `effectiveDate?`(YYYY-MM-DD, 생략 시 승인일(한국 날짜, T-126) — **시점 조회의 기준**. 폐지한 조문이면 폐지일 이후만)

## comments
**CreateArticleCommentDto** — `content`(1~2000자)
**UpdateArticleCommentDto** — `isResolved?`(bool)

## variables
**CreateVariableDto** — `key`(1~120, 예 `DEPT_IN_CHARGE`), `label`(1~200), `description?`(≤2000), `value?`(첫 값, ≤2000), `validFrom?`(YYYY-MM-DD, 비우면 처음부터)
**UpdateVariableDto** — `label?`(1~200), `description?`(≤2000)
**UpsertValueDto** — `value?`, `validFrom?`·`validTo?`(YYYY-MM-DD, 빈 값·null 은 처음부터·끝 없음), `note?`(≤500), `confirmPeriod?`(bool)
**CreateBindingDto** — `variableId`, `start`(≥0), `end`(≥1), `text`(1~500, 화면이 본 그 구간의 문구)

## templates
**CreateTemplateDto** — `name`(≤120), `description?`(≤500), `isDefault?`(기본 false), `isActive?`(기본 true), `layoutJson`(객체, `rawHtml` 문자열 포함 가능), `cssText?`(기본 "")
**UpdateTemplateDto** — 위 필드 전부 optional
**CloneTemplateDto** — `name?`(≤120, 미입력 시 "(복제)" 접미사)

## notifications
**PolicyRevisionNotifyDto**(policies.update에서 사용) — `enabled?`(bool), `userIds?`(문자열 배열, 유니크), `groupIds?`(문자열 배열, 유니크)
**CreateNotificationGroupDto** — `name`(≤80, 예 "정보보안팀"), `userIds?`(문자열 배열)
**UpdateNotificationGroupDto** — `name?`(≤80), `userIds?`

## ask
**AskDto**(T-130) — `question`(앞뒤 공백 제거 후 2~500자)
**AskSettingsDto**(T-130) — `enabled`(bool)

## regulation-parse
**UpdateRegulationParseTreeDto** — `roots`(배열)
**CommitRegulationParseDto** — `code`(1~80), `title`(1~500), `description?`(≤4000)
**CompareReparseDto**(T-110) — `policyId`(uuid)
**ApproveReparseDto**(T-110 ②) — `effectiveDate`(YYYY-MM-DD), `changeNote`(1~500)
**RejectReparseDto**(T-110 ②) — `reason`(1~1000) · **ResolveMissingDto** — `decision`(keep|repeal)
**ReparseDecisionsDto**(T-110) — `items`(≤5000)[`id`(uuid), `decision?`(accept|amend|new|hold|pick|link|keep|repeal, 비우면 미결), `targetArticleId?`(uuid)]
(upload는 multipart 파일 업로드)

## billing
**CheckoutDto** — `targetPlan`(pro|enterprise)
**BillingWebhookDto** — `type`(예 `payment.succeeded`), `data?`{ `tenantSlug`(필수), `targetPlan`(starter|pro|enterprise — 반영은 pro·enterprise 만), `paymentId?`, `orderId?`, `amount?`(숫자) }. T-125 전에는 `data` 에 검증 데코레이터가 없어 전역 검증이 `data` 를 거부했다

## platform-admin
**CreateTenantDto** — `name`(1~100, trim), `slug`(trim+소문자, `^[a-z0-9][a-z0-9-]{1,39}$`), `plan?`(starter|pro|enterprise, 기본 starter), `masterEmail`(이메일, trim+소문자), `masterName`(1~100). 비밀번호 필드는 없다(보내면 400)
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
