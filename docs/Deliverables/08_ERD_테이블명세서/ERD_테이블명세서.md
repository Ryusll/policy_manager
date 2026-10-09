# ERD + 테이블 명세서

작성일: 2026-07-21 (최종 갱신: 2026-09-21)
근거: `apps/api/prisma/schema.prisma` (실제 스키마 전문 반영)

> **2026-09-21**: **3절(법령 개정 연계)을 신설**했다(기존 "참고"는 4절로 밀렸다). 3절만 성격이 다르다 — 1·2절이 실제 스키마를 옮긴 것인 반면 **3절은 아직 스키마에 없는 설계안**이다. 근거는 특허 명세서이고 상세는 [18_법령개정연계_설계](../18_법령개정연계_설계/법령개정연계_설계안.md)에 있다. 마이그레이션을 내기 전까지 3절과 실제 DB는 다르다.

## 1. ERD (관계 개요)

```
Tenant 1───N User
Tenant 1───N Policy 1───N Chapter 1───N Section(선택) ┐
                          └────────────────────────── ├─N Article 1───N ArticleVersion 1───N VariableBinding N───1 Variable 1───N VariableValue
                                (Article.sectionId 는 nullable)
                                          Article 1───N ArticleComment N───1 User
                        Policy 1───N PolicyAppendix
                        Policy N───1 PolicyTemplate (nullable, SetNull)
Tenant 1───N PolicyTemplate
Tenant 1───N Variable
Tenant 1───N NotificationGroup 1───N NotificationGroupMember N───1 User
Tenant 1───N UserNotification N───1 User
Tenant 1───N AuditLog, PolicyImportLog
Tenant 1───N RegulationParseSession N───1 Policy (committedPolicy, nullable)
Tenant 1───1 BillingCustomer 1───N BillingSubscription 1───N BillingPayment
(PlatformBranding: 테넌트와 무관한 단일 행, SaaS 운영사 표기)
```

## 2. 테이블 명세

### Tenant (`tenants`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| name | string | 회사명 |
| slug | string, unique | 로그인 시 조직 식별자 |
| plan | enum PlanTier | starter/pro/enterprise, 기본 starter |
| planExpiresAt | datetime? | |
| billingStatus | enum BillingStatus | active/trial/past_due/canceled |
| aiQaEnabled | bool, 기본 true | 규정 질문(AI) 사용 여부(T-130). 회사 관리자가 끈다 — 질문할 때 관련 조문이 외부 AI 로 간다 |
| createdAt/updatedAt | datetime | |

### User (`users`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK → Tenant (cascade) | |
| email | string | `@@unique([tenantId, email])` |
| passwordHash | string? | OAuth 전용 계정은 null |
| name | string | |
| role | enum Role | admin/editor/viewer, 기본 viewer |
| platformRole | enum PlatformRole | none/global_admin |
| oauthProvider / oauthSub | string? | `@@unique([oauthProvider, oauthSub])` |
| refreshToken | string? | |

### Policy (`policies`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| code | string | `@@unique([tenantId, code])` |
| title / description | string | |
| isActive | boolean | 기본 true |
| metadata | json? | 부서·분류 등 |
| revisionDate / effectiveDate | date? | 개정일/시행일 |
| templateId | uuid FK? → PolicyTemplate (SetNull) | |

### Chapter (`chapters`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| policyId | uuid FK → Policy (cascade) | |
| number | int | 장 번호 |
| title | string | |
| suppressHeader | boolean | 장 제목 미표시 (목차·인쇄) |

### Section (`sections`) — 절(節), 선택 계층
법령은 `편 > 장 > 절 > 조 > 항 > 목` 구조를 갖지만, 사내 규정은 이를 반드시 따르지 않는다. 따라서 절은 **선택 계층**이며 조가 절에 속하지 않아도 된다.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| chapterId | uuid FK → Chapter (cascade) | 절은 항상 장에 속한다 |
| number | int | 절 번호 (제N절) |
| title | string | 절 제목 |
| createdAt/updatedAt | datetime | |

인덱스: `[chapterId, number]`.

### Article (`articles`) — 조·항·목 통합 테이블
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| chapterId | uuid FK → Chapter (cascade) | |
| sectionId | uuid FK? → Section (SetNull) | **nullable**. 절에 속하지 않는 조는 null |
| number | int | 조 번호 |
| branchNumber | int? | 조의 **가지 번호**. "제3조의2"면 `number=3, branchNumber=2`. 가지 조문이 아니면 null. 조 하나 = (`number`, `branchNumber`) — 정렬은 조 → 가지 → 항 → 목 (T-118, 마이그레이션 `20261007200000_article_branch_number`) |
| clauseNumber | int? | 항 번호 (null이면 조 루트/조 본문) |
| itemNumber | int? | 목 번호 (null이면 조 또는 항) |
| title | string | 조/항/목 제목 |
| hasPrecedent / hasRelatedLaw / hasRelatedRule | boolean | 판례·법령·규칙 참조 플래그 |
| relatedPrecedentNote / relatedLawNote / relatedRuleNote | text? | 근거 메모 |

행 유형 판별 규칙: `clauseNumber == null && itemNumber == null` → 조 루트, `clauseNumber` 있고 `itemNumber` null → 항, `itemNumber` 있음 → 목.

계층 필수 여부: **조(Article)만 필수**이고 장·절은 선택이다. 장이 없는 규정은 `suppressHeader: true`인 장 1건을 만들어 조를 담되 화면·인쇄에서 장 제목을 표시하지 않는다(`Article.chapterId`는 DB상 필수로 유지 — 자세한 이유는 [ADR-0011](../10_ADR_의사결정기록/ADR.md) 참고).

### ArticleVersion (`article_versions`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| articleId | uuid FK → Article (cascade) | |
| versionNum | int | |
| content | string | 조문 본문 |
| status | enum VersionStatus | draft/review/published/archived — archived 는 "새 버전에 밀려 내려감(대체)"과 "폐지" 둘 다다. 가르는 것은 `repealedOn`(T-126) |
| changeNote | string? | 조문 단위 개정 사유. 시행 승인 시 필수 |
| reviewNote | string? | **반려 사유**(T-10). 되돌린 초안 카드에 그대로 보인다. 다시 검토 요청하면 지운다 — 남겨 두면 재제출 뒤에도 반려 상태처럼 보인다 |
| effectiveDate | date? | **이 버전이 시행된 날. 시점 조회(as-of)의 기준.** 승인 시 확정(미지정이면 승인일) |
| approvedBy / approvedAt | string?/datetime? | |
| createdBy | string? | |
| publishedAt | datetime? | **발행일** — 시스템에서 시행본으로 발행한 시각(T-108). 시행일·법령 시행일과 다르고 시점 조회의 기준이 아니다. 개정 후보 승인·일반 승인·한꺼번에 시행·가져오기 확정·JSON 일괄 등록이 남긴다(그 전 버전은 비어 있다 — 보정은 T-111) |
| changeEventId | uuid FK? → LawChangeEvent (SetNull) | 이 버전을 낳은 법령 변경 — 개정 후보 승인으로 발행됐을 때만(T-108) |
| sourceCandidateId | uuid FK? unique → AmendmentCandidate (SetNull) | 이 버전을 낳은 개정 후보(T-108). 후보 쪽에는 따로 두지 않고 이 관계로 찾는다 |
| repealedOn | date? | **폐지 시행일**(T-126) — "게시본 폐지"로 내린 버전만 있다(폐지한 날, 한국 날짜). 이 날부터 조문은 시행 중이 아니다: 시점 조회가 이 버전을 고르면 옛 버전으로 되돌아가지 않고 "폐지"로 본다(규정 시점 조회·신구 대비·법령 영향 분석·개정 후보 공통). 새 버전에 밀려 내려간 버전은 비어 있다. 마이그레이션 `20261009120000_article_repeal` 이 기존 폐지를 감사 기록(`version.archive`, 같은 회사) 시각의 한국 날짜로 채웠다 — 감사가 없는 archived 는 비워 둠 |
| structure | json? | **버전별 계층**(T-110 ②, 특허 도 5·13) — 발행 이력이면 그 버전이 시행된 동안의 **얼린 계층**(장 id·번호·제목, 절, 조·가지·항·목, 조 제목 — 계층이 실제로 바뀌는 승인 때 그 조문의 얼리지 않은 발행 이력 모두에 넣는다), 초안·검토 중이면 재파싱의 **제안 계층**(승인 때 조문 행으로 옮기고 비운다). 시행본은 늘 비어 있다(지금 계층 = 조문 행). 옛 기록은 비어 있어 지금 계층을 따른다 |
| reparseItemId | uuid? (unique) | 이 버전을 만든 재파싱 검토 항목(T-110 ②) — 묶음으로만 검토 요청·승인·반려한다(단건 처리·한꺼번에 시행에서 빠진다) |

인덱스: `[articleId, effectiveDate]` — 시점 조회에서 조문별 "기준일 이전 시행분 중 가장 최근"을 찾는 경로. 유니크: `[articleId, versionNum]`(T-128, 마이그레이션 `20261010020000_article_version_unique` — 이미 번호가 겹친 조문은 지금 순서대로 1부터 다시 매긴 뒤 건다).

### ArticleComment (`article_comments`)
tenantId, articleId FK, userId FK, content, isResolved. 인덱스: `[tenantId, articleId]`.

### PolicyAppendix (`policy_appendices`)
policyId FK, kind(enum PolicyAppendixKind: supplementary/annex/form), title, body(text), sortOrder. 인덱스: `[policyId, kind]`, `[policyId, sortOrder]`.

### PolicyRevisionReason (`policy_revision_reasons`) — 제정·개정 이유(개정문)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| policyId | uuid FK → Policy (cascade) | |
| kind | enum PolicyRevisionKind | enactment=제정 / amendment=일부개정 / full_amendment=전부개정 / repeal=폐지 |
| label | string | 차수 라벨 (예: "제3차 일부개정") |
| reason | text | 개정 이유 본문 |
| summary | text? | 주요 변경사항 |
| promulgatedDate / effectiveDate | date? | 공포일 / 시행일 |
| createdBy | string? | |

인덱스: `[policyId, effectiveDate]`.
**조문 단위 사유는 `ArticleVersion.changeNote`가 담당**하고, 이 테이블은 문서 차수 단위를 담당한다. 규정 상세의 "제정·개정이유" 화면이 둘을 함께 보여준다.

### PolicyTemplate (`policy_templates`)
tenantId FK, name, description, isDefault, isActive, layoutJson(json), cssText. `@@unique([tenantId, name])`, 인덱스 `[tenantId, isDefault]`.

### Variable / VariableValue / VariableBinding (`variables` / `variable_values` / `variable_bindings`) — T-109
Variable: tenantId FK, key, label, description — `@@unique([tenantId, key])`. 값은 `VariableValue` 에 기간과 함께 여럿(옛 `defaultValue` 는 기간 미확정 값으로 옮기고 지웠다).

VariableValue: tenantId FK(필수 — 범위는 그 회사), variableId FK(cascade), value, **validFrom**(date?, 포함, null = 처음부터), **validTo**(date?, 미포함, null = 끝 없음), **periodConfirmed**(옛 기본값을 옮긴 값은 false — 기간을 정하기 전에는 고르지 않는다), note, createdBy. 인덱스 `[variableId, validFrom]`. 같은 변수에서 기간이 겹쳐도 저장은 받는다(DB 로 막을 수 없다) — 화면이 "검토 필요"로 보이고, 그 날짜에 맞는 값이 **정확히 하나**일 때만 쓴다(나중에 시작한 값이 이기지 않는다).

VariableBinding(옛 `VariableUsage` 대체): tenantId, variableId(cascade), articleId(cascade), **versionId**(기준 조문 버전, cascade), **start·end**(그 버전 본문의 UTF-16 구간 [start, end)), **text**(당시 문구 — 옛 표식이면 `{{KEY}}`), contextBefore·contextAfter(앞뒤 20자), **occurrence**(같은 문구 중 몇 번째), **origin**(manual 화면에서 골라 이음 / marker 검토 요청 때 표식을 값으로 / legacy 옛 사용 기록 / inherited 발행 때 앞 버전에서 옮김), **state**(active / needs_review 다시 이어야 함 / released 풀었음 — 이력으로 남김), reviewReason(span_changed·legacy_unmatched·position_unverified), **valueId**(그 구간에 든 값 — 직전 적용값, SetNull), **parentId**(앞 버전의 연결 — 계보, SetNull). 인덱스 `[versionId, state]`·`[variableId, state]`·`[articleId]`. 새 버전을 발행하면 옛 행은 그대로 두고 위치를 옮긴 새 행을 새 버전에 만든다.

### NotificationGroup / NotificationGroupMember (`notification_groups` / `notification_group_members`)
NotificationGroup: tenantId FK, name — `@@unique([tenantId, name])`.
NotificationGroupMember: 복합 PK `[groupId, userId]`, N:M 매핑 테이블.

### UserNotification (`user_notifications`)
tenantId FK, userId FK, kind(기본 "policy_revision", 법령 개정 후보 알림은 "law_amendment" — T-106), title, body(text), policyId/articleId/versionId(참조용, FK 아님), link?(규정이 아닌 화면으로 가는 이동 경로, 예 `/laws/:id?change=` — T-106), readAt. 인덱스: `[userId, readAt, createdAt]`, `[tenantId, createdAt]`.

### AuditLog (`audit_logs`)
tenantId FK, userId FK?(SetNull), action, entityType, entityId, details(json).

### AiQaLog (`ai_qa_logs`) — T-130 규정 질문 기록
tenantId FK(cascade), userId FK?(SetNull), question(text), answerable(근거가 남아 답을 내보냈는가), answer(json? — 화면에 낸 답 블록, 답하지 않았으면 null), citedArticleIds(text[] — 근거로 보여 준 조문 행), contextRowCount(AI 에 본문을 준 행 수), aiCalled(AI 를 불렀는가 — 월 한도는 이것만 센다), model?, inputTokens·outputTokens·cacheReadTokens(사용량·비용 집계). 인덱스: `[tenantId, createdAt]`. 마이그레이션 `20261009230000_ai_qa`.

### PolicyImportLog (`policy_import_logs`)
tenantId FK, userId FK?, policyId FK?, sourceName, parseProfile, chapterCount, articleCount, cleanupOptions(json), status, message. 인덱스: `[tenantId, createdAt]`.

### RegulationParseSession (`regulation_parse_sessions`)
tenantId FK, userId FK?, fileName, mimeType, status(기본 "pending"), extractedText(text), extractMeta(json), parseTree(json), errorMessage, committedPolicyId FK? → Policy(관계명 CommittedParsePolicy). 인덱스: `[tenantId, createdAt]`.

### TenantBranding (`tenant_branding`)
테넌트당 1행(PK = `tenantId`). brandMark, logoDataUrl(data URL, 350KB 상한), logoWidth·logoHeight, updatedBy. Tenant 삭제 시 Cascade.
플랫폼(운영사) 브랜딩인 `PlatformBranding` 과 다르다 — 이쪽은 **고객사** 로고·배지다([ADR-0014](../10_ADR_의사결정기록/ADR.md), T-57).

### Favorite (`favorites`)
tenantId·userId·policyId FK, articleId FK(nullable — null 이면 규정 즐겨찾기, 값이 있으면 조문 즐겨찾기).
**Postgres 는 NULL 을 서로 다른 값으로 보므로 `@@unique` 만으로는 규정 즐겨찾기 중복을 막지 못한다** — 서비스에서 먼저 조회한다(T-80).

### PlatformBranding (`platform_branding`)
테넌트 무관 단일 행(SaaS 운영사 표기). id, legalName, registrationNo, productLabel(기본 "Policy Manager"), logoDataUrl, lockupImageSrc.

> **주의**: 아래 Billing 3개 테이블(`BillingCustomer`/`BillingSubscription`/`BillingPayment`)은 스키마에만 존재하며 현재 애플리케이션 코드에서 읽거나 쓰지 않는다. 결제 처리는 `tenant.plan` 갱신 + 감사 로그만 수행한다 ([03_SRS 14.1](../03_SRS_요구사항명세/SRS_요구사항명세.md) 참고).

### BillingCustomer (`billing_customers`)
tenantId FK, unique — 테넌트당 1행. provider(기본 "mock"), providerCustomerId.

### BillingSubscription (`billing_subscriptions`)
tenantId FK, billingCustomerId FK?(SetNull), provider, providerSubscriptionId, plan(PlanTier), status(SubscriptionStatus: active/trial/canceled/expired), startedAt, currentPeriodStart/End, canceledAt. 인덱스: `[tenantId, status]`, `[provider, providerSubscriptionId]`, `[currentPeriodEnd]`.

### BillingPayment (`billing_payments`)
tenantId FK, billingCustomerId FK?, subscriptionId FK?, provider, providerPaymentId, providerOrderId, amount(int), currency(기본 "KRW"), status(PaymentStatus: succeeded/failed/refunded), paidAt, refundAt, metadata(json). 인덱스: `[tenantId, createdAt]`, `[status, paidAt]`, `[provider, providerPaymentId]`.

## 3. 법령 개정 연계

특허 명세서를 근거로 한 설계다. 전체 맥락·처리 흐름·API 는
[18_법령개정연계_설계](../18_법령개정연계_설계/법령개정연계_설계안.md)를 본다.

| 테이블 | 상태 |
|---|---|
| `LawSource` / `Law` / `LawArticle` | ✅ **스키마에 있다** (T-100, 마이그레이션 `20260925090000_law_entities`) |
| `LawLink` | ✅ **스키마에 있다** (T-101, 마이그레이션 `20260925142102_law_links`) |
| `LawChangeEvent` | ✅ **스키마에 있다** (T-103, 마이그레이션 `20260930124231_law_change_events`) |
| `LawSyncRun` · `Law.lastCheckError` | ✅ **스키마에 있다** (T-104, 마이그레이션 `20261007100000_law_sync_runs`) |
| `AmendmentCandidate` · `LawChangeEvent.amendmentsProcessedAt` · `UserNotification.link` | ✅ **스키마에 있다** (T-106, 마이그레이션 `20261008120000_amendment_candidates`) |
| `AmendmentRevision` · `AmendmentStateChange` · `AmendmentCandidate.revision`·`lockVersion` | ✅ **스키마에 있다** (T-107, 마이그레이션 `20261008180000_amendment_review`) |
| `ArticleVersion.publishedAt`·`changeEventId`·`sourceCandidateId` · `AmendmentCandidate.baseFingerprint` | ✅ **스키마에 있다** (T-108, 마이그레이션 `20261009090000_amendment_approval`) |
| `VariableValue` · `VariableBinding`(옛 `VariableUsage` 대체) | ✅ **스키마에 있다** (T-109 ①, 마이그레이션 `20261009150000_variable_values_bindings`) |
| `AmendmentCandidate.plannedEffectiveDate`·`variableFingerprint` | ✅ **스키마에 있다** (T-109 ②, 마이그레이션 `20261009180000_amendment_variables`) |
| `ReparseReview` · `ReparseReviewItem` | ✅ **스키마에 있다** (T-110 ①, 마이그레이션 `20261009210000_reparse_reviews`) |
| `ArticleVersion.structure`·`reparseItemId` · `ReparseReview` 반영·승인 필드 · `ReparseReviewItem.outcome` | ✅ **스키마에 있다** (T-110 ②, 마이그레이션 `20261009230000_reparse_apply`) |

### 3.1 관계 개요

```
LawSource 1───N Law 1───N LawArticle ───┬─N LawChangeEvent   (lawId 도 직접 가진다 — 조문 삭제 시 lawArticleId 는 SetNull)
                                        │
                                        └─N LawLink N───1 Article   (사내 조문)
                                             ▲ tenantId 필수

LawChangeEvent 1───N AmendmentCandidate N───1 Article
                                        └──1 ArticleVersion (baseVersionId = 제1 조문)
                                        ▲ tenantId 필수

Variable 1───N VariableValue      (값별 유효기간, 범위 = 그 회사)
Variable 1───N VariableBinding N───1 ArticleVersion   (본문 구간 연결, 발행 때 새 버전으로 옮김 — parentId 계보)
```

### 3.2 테넌트 경계 — **이 설계에서 가장 틀리기 쉬운 곳**

| 테이블 | `tenantId` | 이유 |
|---|:--:|---|
| `LawSource` / `Law` / `LawArticle` | ❌ | 법령은 모든 고객사에 같은 내용이다. 테넌트마다 복사하면 같은 법을 고객사 수만큼 폴링하게 된다 |
| `LawChangeEvent` | ❌ | 법이 바뀐 사실 자체는 공용. **누가 영향받는지는 `LawLink` 가 정한다** |
| `LawLink` | ✅ | 우리 회사의 어느 조문이 이 법에 걸리는지 — 회사 기밀 |
| `AmendmentCandidate` | ✅ | 우리 회사 규정의 개정 초안 |

> ⚠️ `LawArticle` 에 `tenantId` 가 없으므로 **법령조항 id 로 시작하는 조회는 경계가 없다.**
> 반드시 `LawLink.tenantId` 에서 걸어야 한다. T-41 감사에서 찾은 2건이 전부 **"부모를 안 보고 자식만 확인한"** 경우였고, 여기서 같은 실수가 가능하다.

### 3.3 신규 테이블

#### LawSource (`law_sources`) — 법령원 ✅ 구현됨
id, code(unique, 예 `law.go.kr`), name, baseUrl, isActive.
등록 시 `law.go.kr` 행을 upsert 로 보장한다(별도 시드 불필요).

#### Law (`laws`) — 법령, 테넌트 공용 ✅ 구현됨
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| sourceId | uuid FK → LawSource | |
| externalId | string | 법제처 MST(법령일련번호) |
| lawName / lawNo | string / string? | 법령명 / 법령번호 |
| promulgatedDate | date? | 공포일 |
| effectiveDate | date? | **법령 시행일** (≠ 사내 규정 시행일) |
| versionKey | string? | 현재 수신본의 지문. 바뀌면 개정. 조항 지문을 **문서 순서대로** 이어 해시한다 |
| lastCheckedAt | datetime? | 마지막 확인 **시도** 시각. 실패해도 갱신한다 — 고장 난 법령 하나가 매번 맨 앞에 서지 않게 |
| lastCheckError | text? | 마지막 확인이 실패했으면 사유, 성공이면 null — **"개정 없음"과 "확인 못 함"을 가른다** (T-104) |

`@@unique([sourceId, externalId])`, 인덱스 `[lastCheckedAt]`(폴링 대상 선정).

#### LawArticle (`law_articles`) — 법령조항, 테넌트 공용 ✅ 구현됨
lawId FK, **nodeKey**, articleNo(조), clauseNo(항, null 허용), itemNo(호, null 허용),
label(사람이 읽는 표기), title?, content(text), versionKey, effectiveDate?, sortOrder,
deletedAt?(법령에서 사라진 시각 — T-124, 마이그레이션 `20261010030000_law_article_deleted_at`).
`@@unique([lawId, nodeKey])`, 인덱스 `[lawId, sortOrder]`.

**사라진 조항은 지우지 않는다(T-124).** 동기화에서 응답에 없는 조항은 `deletedAt` 만 채운다 — 지우면 회사들이 걸어 둔
`LawLink` 가 cascade 로 함께 지워져 그 "삭제됨" 이벤트의 영향 분석·개정 후보에서 사내 조문을 찾을 수 없었다.
조항 목록·건수·새 연결·자동 추천에서는 빠지고, 같은 nodeKey 가 다시 나타나면 `null` 로 되살린다(같은 행이라 연결이 이어진다).

**청구항의 "법령조항 식별자"가 이 레코드의 `id`** 다.

##### 설계안과 달라진 점 — 식별자를 `nodeKey` 로 (T-100)

설계안은 `@@unique([lawId, articleNo, clauseNo, itemNo])` 였는데 두 가지가 깨진다.

1. **Postgres 는 UNIQUE 에서 NULL 을 서로 다른 값으로 본다.** 조 본문 행은
   `clauseNo`·`itemNo` 가 둘 다 NULL 이라 **중복이 전혀 막히지 않는다**(같은 조를 두 번
   넣어 확인). `Favorite` 에서 이미 같은 함정을 만났다 — 위 `favorites` 항목 참고.
2. **`articleNo Int` 로는 제3조와 제3조의2 를 구분할 수 없다.** 근로기준법 실제 데이터
   478개 조항 중 **92개가 가지번호**다. 설계 원안대로면 이 92건이 전부 충돌한다.

그래서 식별은 `nodeKey` 문자열 하나로 한다(`3의2/1/2` = 제3조의2 제1항 제2호,
`5//` = 제5조). 숫자 컬럼 3개는 조회·정렬용으로 남긴다.

`itemNo` 가 설계의 "목"이 아니라 **호**인 것도 같은 맥락이다. 법령은 조>항>호>목 4단인데
우리 모델은 3단이라, 남는 목(가./나.)은 행을 더 만들지 않고 부모 호 본문에 합친다
(`commit-rows.ts` 와 같은 판단). 목 본문이 부모 지문에 포함되므로 변경 감지는 걸린다.

#### LawLink (`law_links`) — 법령 관계 정보 ⚠️ 테넌트별
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK → Tenant (cascade) | **누락 금지** |
| lawArticleId | uuid FK → LawArticle | |
| articleId | uuid FK → Article (cascade) | 사내 조문 |
| relationType | enum LawRelationType | delegation(위임)/application(준용)/citation(인용)/obligation(의무)/reference(참고) |
| scope | string? | 적용 범위 (예: "정규직에 한함") |
| evidenceText | text? | 관계의 근거 문구 |
| confidence | float? | 신뢰도 0.0~1.0 (자동 추천일 때) |
| confirmState | enum LawLinkState | suggested(자동 추천)/confirmed(사용자 확정)/rejected |
| confirmedBy / confirmedAt | string? / datetime? | |

`@@unique([tenantId, lawArticleId, articleId])`, 인덱스 `[tenantId, articleId]`(조문 상세에서 "걸린 법" 보기), `[lawArticleId, confirmState]`(영향 분석 진입 경로).

**이 테이블이 청구항 3의 "관계 그래프"의 간선이다.** 법령조항 노드에서 출발해 여러 규정의 사내 조문 노드로 퍼진다.
`Article.relatedLawNote`(자유 텍스트 메모)를 대체하는 것이 아니라 **기계가 따라갈 수 있는 형태를 새로 만드는 것**이다.

#### LawChangeEvent (`law_change_events`) — 변경 이벤트, 테넌트 공용 ✅ 구현됨 (T-103)
lawId FK(cascade), lawArticleId FK?(**SetNull**), nodeKey, changeType(enum LawChangeType: created/modified/deleted), beforeContent(text?), afterContent(text?), beforeVersionKey?, afterVersionKey?, promulgatedDate(공포일), lawEffectiveDate(법령 시행일), receivedVia(enum LawEventChannel: poll/manual/webhook — **수신경로**), detectedAt.
amendmentsProcessedAt?(개정 후보 자동 생성을 마친 시각 — T-106. null 이면 동기화가 끝날 때 처리하고, 한 회사라도 실패하면 비워 둬 다음 실행에서 다시 처리한다. 기능 도입 전 이벤트는 마이그레이션이 감지 시각으로 채웠다).
인덱스 `[lawArticleId, detectedAt]`, `[lawId, detectedAt]`, `[lawEffectiveDate]`, `[amendmentsProcessedAt]`.

`POST /api/laws` 재등록이 만든다 — 조항별 `versionKey` 를 직전 값과 비교해 신설·변경·삭제만 남긴다(공백만 다르면 지문이 같아 제외).
**최초 등록은 만들지 않는다** — 비교할 이전 상태가 없는데 그대로 돌리면 조문 수만큼 "신설"이 쌓인다.

설계안 대비 달라진 점:
- 조문이 삭제되는 개정도 기록하려고 `lawArticleId`·`afterContent`·`afterVersionKey` 를 null 허용으로, FK 를 `SetNull` 로 뒀다. 설계안대로 필수 FK + Cascade 면 "삭제됨" 이벤트가 조문과 함께 지워진다. 그래서 `lawId`·`nodeKey` 를 이벤트에 직접 둔다 — 조문이 지워진 뒤에도 어느 법·어느 조문인지 남는다.
- `changeType` 추가 — 신설·삭제를 before/after 가 null 인지로 매번 되짚지 않게.

주기 동기화(T-104)도 같은 경로로 만든다(`receivedVia=poll`). 새 판은 **같은 `Law` 행의 MST 를 바꿔** 반영한다 — 새 MST 로 행을 새로 만들면 `LawLink` 가 옛 판에 남는다.

#### LawSyncRun (`law_sync_runs`) — 법령 동기화 실행 기록, 테넌트 공용 ✅ 구현됨 (T-104)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| trigger | enum LawSyncTrigger | `schedule`(서버 cron → CLI) / `manual`(플랫폼 관리자 화면) |
| status | enum LawSyncStatus | `running` / `succeeded`(0건 포함) / `partial`(일부 실패) / `failed`(전부 실패 또는 실행 오류) |
| triggeredBy | string? | 수동 실행한 사용자 id |
| startedAt / finishedAt | datetime / datetime? | |
| checkedCount / changedCount / eventCount / failedCount | int | 확인한 법령 / 새 판이 있던 법령 / 만들어진 변경 이벤트 / 실패한 법령 |
| results | json? | 법령별 결과 `[{ lawId, lawName, outcome(unchanged·updated·failed), fromMst, toMst?, events?, error?, note? }]` |
| error | text? | 실행 전체가 실패한 사유 |

인덱스 `[startedAt]`. 동시 실행은 advisory lock + "진행 중" 확인으로 막고, 30분 넘게 `running` 인 행은 다음 실행이 "중단됨"(`failed`)으로 닫는다.

#### AmendmentCandidate (`amendment_candidates`) — 후보 레코드 ⚠️ 테넌트별 ✅ 구현됨 (T-106)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK → Tenant (cascade) | **누락 금지.** 조문의 실제 소속(chapter→policy→tenant)도 함께 본다 |
| articleId | uuid FK → Article (cascade) | 영향 조문 |
| baseVersionId | uuid FK → ArticleVersion (cascade) | **제1 조문** — 만들 때의 기준 발행본. 그 뒤 새 버전이 시행돼도 바꾸지 않는다 |
| baseFingerprint | string? | 만들 때 그 조문의 **발행 이력 지문** — 시행본·폐지본의 id·상태·시행일·번호의 SHA-256(`fp1:` 접두어, T-108). 승인 때 다시 계산해 다르면 그 사이 다른 발행·폐지·시행일 보정이 있었다는 뜻이라 막는다. 마이그레이션이 기존 후보를 같은 계산으로 채웠다 |
| changeEventId | uuid FK → LawChangeEvent (**restrict**) | 개정의 원인. 지워지면 원천이 사라지므로 법령 추적 해제를 막는다 |
| lawLinkId | uuid FK? → LawLink (SetNull) | 영향을 찾은 연결. 지워져도 후보는 남는다(근거는 rationale 스냅샷) |
| candidateContent | text | **제2 조문** — 개정 후보 본문. 반영한 것이 없으면 제1 조문 그대로 |
| rationale | json | 변경 근거 정보 — 법령 변경 부분·연결 스냅샷(유형·근거 문구·확정 상태)·경로·적용 규칙·반영하지 못한 변경·충돌·기준 발행본·**변수 근거** `variables[]`(T-109 ②, `rationale/2` — 연결·고른 값(id·문구)·유효기간·범위·기준/후보 위치·상태(넣음·그대로·보류·충돌)·까닭) |
| diff | json | 변경 전후 비교 정보 — 제1 조문 대 후보의 실제 차이(문자 구간, 구간별 근거 연결 — 법령 `rationaleRefs` 와 변수 `variableRefs` 를 따로(T-109 ②), 근거 없는 구간 수) |
| generationMethod | enum AmendmentMethod | rule(규칙+템플릿) / llm(언어모델, T-112) |
| variant | string | 같은 방식 안의 개정안 구분 — 규칙 기반은 규칙 세트 버전(`rule/1`, 변수 값 넣기를 더한 `rule/2` — T-109 ②) |
| generationMeta | json? | 규칙·템플릿 id·버전, 신뢰도 판정(단계·이유·반영률), 입력 원천(이벤트·전후 판 키·조문·발행본·연결·기준일), 생성 주체(user/system) |
| confidence | enum AmendmentConfidence | high / medium / low — 후보 신뢰도. 관계 신뢰도(`LawLink.confidence`)와 별개 |
| reviewFlags | string[] | 사람이 봐야 하는 이유(`manual_draft_required`·`ambiguous_match`·`rule_conflict` 등) |
| reviewState | enum AmendmentState | draft / review / approved / rejected (기본 draft) |
| revision | int | 지금 본문의 판 번호 — 생성본 1, 사람이 고칠 때마다 1씩(T-107). 판마다의 본문은 `AmendmentRevision` |
| lockVersion | int | 낙관적 잠금 — 손질·검토 요청 등 후보가 바뀔 때마다 1씩. 화면이 본 값과 다르면 409(T-107) |
| asOfDate | date | 영향 분석 기준일 — 제1 조문을 고른 날 |
| plannedEffectiveDate | date | **예정 사내 시행일**(T-109 ②) — 변수 값을 고른 날. 법령 시행일·영향 분석 기준일과 다르다. 승인 때 확정하는 시행일은 따로 받고, 그 날 다시 고른 변수 값이 이 후보와 다르면 승인하지 않는다. 기존 후보는 만들 때의 기준일로 채웠다 |
| variableFingerprint | string | 변수 입력 지문(`vf1:` 접두어, 연결이 없으면 빈 값) — 연결·고른 값·결과. 같은 기준 본문이라도 값만 달라진 후보를 가른다 |
| createdBy | string? | 만든 사람. 동기화가 자동으로 만들었으면 null |
| createdAt / updatedAt | datetime | |

유니크 `[tenantId, changeEventId, articleId, baseVersionId, baseFingerprint, generationMethod, variant, plannedEffectiveDate, variableFingerprint]`(뒤의 둘은 T-109 ②) — 자동 생성과 버튼이 겹치거나 다시 눌러도 같은 후보는 하나다(`INSERT … ON CONFLICT DO NOTHING`). 발행 이력 지문이 들어 있어, 기준 본문은 같아도 그 사이 다른 발행이 있었으면 "다시 만들기"가 새 후보를 만든다(T-108).
인덱스 `[tenantId, reviewState, createdAt]`, `[tenantId, articleId]`, `[changeEventId]`.
승인·반려(T-108)는 컬럼을 더하지 않았다 — 결정(누가·언제·어느 판·사유)은 `AmendmentStateChange` 에, 승인으로 발행된 버전은 `ArticleVersion.sourceCandidateId` 역관계로 찾는다.

#### AmendmentRevision (`amendment_revisions`) — 개정 후보의 판 ⚠️ 테넌트별 ✅ 구현됨 (T-107)
생성본(판 1)부터 사람이 고칠 때마다 하나씩 쌓고 **바꾸지 않는다**(특허 도 11 — 수정 전후 보존). 수정 전 내용은 직전 판이다.
tenantId FK(cascade), candidateId FK → AmendmentCandidate(cascade), revision(int), content(text — 그 판의 본문), contentHash(SHA-256 hex — 감사 기록·승인 대상 식별), diff(json — 제1 조문 대 그 판, 손질한 판은 규칙 근거를 다시 이은 것), note(text? — 수정 사유, 사람이 고친 판은 필수·생성본은 없음), editedBy?(생성본이면 null), stateBefore(enum? — 고치기 전 상태), createdAt.
유니크 `[candidateId, revision]`, 인덱스 `[tenantId, candidateId]`. 마이그레이션이 기존 후보의 생성본을 판 1 로 채웠다.

#### AmendmentStateChange (`amendment_state_changes`) — 개정 후보의 상태 전환 기록 ⚠️ 테넌트별 ✅ 구현됨 (T-107)
본문이 바뀌지 않는 전환(검토 요청 등)도 남아야 해서 판과 따로 둔다. tenantId FK(cascade), candidateId FK(cascade), fromState·toState(enum AmendmentState), revision(int — 전환이 가리키는 판, 검토 요청이면 검토 대상 판), reason(text? — 요청 사유·요청 취소 사유·반려 사유), actorId?, createdAt. 인덱스 `[candidateId, createdAt]`.
진행 중인 검토 요청 = 후보가 검토 상태일 때 가장 최근의 `→ review` 전환.

> 판과 상태 전환은 후보와 함께 지워진다(조문·기준 버전 삭제 → 후보 cascade). 초안의 작업 기록이라 그렇게 두고, 감사 로그(`amendment.edit`·`amendment.request_review`)에는 판 번호·해시·사유가 남는다. 승인된 후보의 보존은 T-108 에서 정한다.

**발행 버전은 승인 전까지 건드리지 않는다.** 후보를 별도 테이블에 두는 것만으로 청구항 5의 *"승인 정보를 수신하기 전까지 발행 버전의 본문을 유지"* 가 충족된다.

#### VariableValue (`variable_values`) — 변수 값 (T-109 ①, 위 2절)
설계 때의 `tenantId?`(null = 전역 기본값)는 쓰지 않았다 — 변수가 이미 회사 소유라 값의 범위도 그 회사다(전역·회사 안 조직 범위는 미룸).
기간 겹침은 DB 로 막을 수 없어 **저장은 받되 "검토 필요"로 보이고, 그 날짜에 맞는 값이 정확히 하나일 때만 쓴다** — 설계 때의 "나중에
시작한 값이 이긴다"는 버렸다(어느 값이 들어갔는지 조용히 정하면 개정 초안을 믿을 수 없다). 사용자 지시로 코덱스 자문(T-109 결정 4).

#### ReparseReview / ReparseReviewItem (`reparse_reviews` / `reparse_review_items`) — 재파싱 검토 ⚠️ 테넌트별 ✅ 구현됨 (T-110 ①)
다시 가져온 원문을 고른 규정의 조문과 계층·내용 지문 두 축으로 맞춘 결과와 사람의 결정(청구항 2, 도 6). 규정 데이터는 바꾸지 않는다.

| 필드 | 타입 | 설명 |
|---|---|---|
| ReparseReview.tenantId · policyId · sessionId? | uuid | 회사·대상 규정(사람이 고른 규정 식별 정보, 규정을 지우면 함께)·원문 세션(세션을 지우면 비움) |
| ReparseReview.sourceName | string | 원문 출처 이름(업로드 파일명·법제처 법령명) — 규정 식별 정보와 따로 둔다 |
| ReparseReview.status | string | `open`(결정 중) · `superseded`(같은 원문을 다시 비교함) · `applied`(반영함 — 묶음 초안) · `submitted`(묶음 검토 요청) · `approved`(묶음 승인) · `rejected`(묶음 반려) |
| ReparseReview.plan | json | 반영 계획(T-110 ②) — 승인 때 만들 장·절(계획 키), 기존 장·절의 번호·제목 변경, 새 조문(자리·본문), 버전 없는 조 머리 행 옮김, 폐지 |
| ReparseReview.bundleFingerprint | string | 묶음 지문(`bf1:`) — 반영·검토 요청 때의 장·절·조문 계층, 조문마다 발행 이력(상태·시행일·폐지일·얼린 계층)과 작업본(상태·제안 계층·묶음 여부), 계획. 검토 요청 뒤에는 묶음 버전 본문까지. 다음 단계에서 다시 계산해 다르면 409 |
| ReparseReview.appliedAt·By · submittedAt·By · effectiveDate · changeNote · approvedAt·By · rejectedAt·By · rejectReason | timestamp·uuid·date·string | 반영·묶음 검토 요청·묶음 승인(사내 규정 시행일·개정 사유)·묶음 반려(사유) |
| ReparseReview.algorithm · normalizer | string | 판정 규칙 `reparse/1` · 정규화 규칙 `norm/1` — 바뀌면 지문끼리 비교할 수 없어 함께 남긴다 |
| ReparseReview.stateFingerprint | string | 비교할 때의 규정 상태 지문(`st1:` — 장·절·조문 계층·제목, 비교 대상 버전 id·상태·본문 지문, 작업본). 다시 계산해 다르면 "다시 비교" |
| ReparseReview.summary | json | 종류별 개수·장 단위 변경·부칙·별표 수·작업본이 있는 조문 수·원문 트리 지문(`tr1:`) |
| ReparseReviewItem.seq · kind | int · string | 순번(검토 안에서 유니크) · `same`·`moved`·`changed`·`ambiguous`·`new`·`missing` |
| ReparseReviewItem.articleId? | uuid | 대응한 기존 조문(같음·옮김·본문 바뀜·원문에 없음). 조문을 지우면 비움 |
| ReparseReviewItem.parsed · stored · candidates | json | 재파싱 행(계층·장·절·제목·본문·지문·번호 다시 매김) · 비교 대상(버전 id·번호·상태·시행/폐지일·본문·지문, 계층·장·절·제목, 작업본) — 반영·승인 때 다시 확인할 기준 · 판정 보류 후보 |
| ReparseReviewItem.reasons · changes · recommended | json · json · bool | 판정 근거 · 바뀐 것(본문·띄어쓰기만·번호·장·절·제목) · 결정을 미리 골라 둘 만큼 근거가 있다 |
| ReparseReviewItem.decision? · targetArticleId? · decidedBy? · decidedAt? | string · uuid · uuid · timestamp | 결정(accept·amend·new·hold·pick·link·keep·repeal, 비우면 미결)과 고르기·잇기 대상, 정한 사람·시각 |
| ReparseReviewItem.outcome | json | 반영·승인의 결과(T-110 ②) — 개정·자리 옮김·장 변경 초안(버전 id), 새 조문(승인 때 조문·버전 id), 조 머리 행 옮김, 폐지(예정·함·미결), 보류, 유지 |

인덱스 `[tenantId, policyId, createdAt]`·`[sessionId]`·항목 `[articleId]`, 유니크 `[reviewId, seq]`. **내용 지문은 저장하지 않는다**(아래 3.4) —
비교할 때 비교 대상 버전 본문으로 계산해 항목에 남긴다.

### 3.4 기존 테이블 변경

| 테이블 | 추가 필드 | 근거 |
|---|---|---|
| `Article` | ~~`fingerprint String?`~~ **두지 않았다**(T-110, 사용자 지시로 코덱스 자문) | 청구항 2 — 지문은 조문의 정체가 아니라 특정 버전 본문에서 나온 값이다. 비교할 때 비교 대상 버전 본문으로 계산하고(특허도 "저장된 지문이 없으면 같은 방식으로 생성") 재파싱 검토 항목에 남긴다 — 쓰기 경로마다 저장값을 맞출 필요가 없다 |
| `ArticleVersion` | `publishedAt DateTime?` | 청구항 7 — **발행일**. 현재는 `approvedAt`(승인 시각)·`effectiveDate`(시행일) 둘뿐 |
| `ArticleVersion` | `changeEventId String?` | 청구항 7 — 후속 버전을 변경 이벤트와 연결 |
| `ArticleVersion` | `sourceCandidateId String?` | 청구항 6 — 이 버전이 어느 후보에서 왔는지 (감사 추적) |
| `VariableUsage` → `VariableBinding` | (T-109 ① 에서 새 표로 바꿈 — 위 2절) | 청구항 5 — **본문 내 사용 위치**. 예전 `VariableUsage` 는 `(versionId, variableId)` 뿐이라 "이 버전이 이 변수를 쓴다"는 사실만 알았다 — 한 버전에 여러 자리를 두려고 구간을 가진 행으로 바꿨다 |

**날짜 3종 정리** (청구항 7):

| 날짜 | 어디에 | 의미 |
|---|---|---|
| 법령 시행일 | `LawChangeEvent.lawEffectiveDate` | 바뀐 법이 효력을 갖는 날 |
| 발행일 | `ArticleVersion.publishedAt` | 사내에서 개정을 확정·공표한 날 |
| 사내 규정 시행일 | `ArticleVersion.effectiveDate` | 개정된 사내 규정이 효력을 갖는 날 |

**시점 조회(as-of)의 기준은 `effectiveDate` 하나로 유지한다.** `publishedAt` 을 기준으로 바꾸면 "발행은 했지만 아직 시행 전인 개정"이 조회 결과에 섞인다.

## 4. 참고
- 모든 타임스탬프는 `createdAt`(default now) / `updatedAt`(@updatedAt) 패턴 일관 적용
- 테넌트 격리는 각 모델의 `tenantId` FK(대부분 `onDelete: Cascade`)로 이루어지며, DB 레벨 Row-Level Security는 적용되어 있지 않음 — 애플리케이션 코드가 매 쿼리에 `tenantId` 필터를 직접 걸어야 함 (누락 시 테넌트 간 데이터 노출 위험, [15_보안검토서](../15_보안검토서/보안_검토서.md) 참고)
- 스키마 변경 이력은 2026-08-02 baseline으로 스쿼시되어 마이그레이션 파일 2건(`00000000000000_init`, `00000000000001_enable_pgbigm`)만 남아 있음 — [04_시스템아키텍처](../04_시스템아키텍처/시스템아키텍처.html) 7절 참고
