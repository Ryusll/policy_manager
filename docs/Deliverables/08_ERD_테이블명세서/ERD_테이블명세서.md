# ERD + 테이블 명세서

작성일: 2026-07-21 (최종 갱신: 2026-09-21)
근거: `apps/api/prisma/schema.prisma` (실제 스키마 전문 반영)

> **2026-09-21**: **3절(법령 개정 연계)을 신설**했다(기존 "참고"는 4절로 밀렸다). 3절만 성격이 다르다 — 1·2절이 실제 스키마를 옮긴 것인 반면 **3절은 아직 스키마에 없는 설계안**이다. 근거는 특허 명세서이고 상세는 [18_법령개정연계_설계](../18_법령개정연계_설계/법령개정연계_설계안.md)에 있다. 마이그레이션을 내기 전까지 3절과 실제 DB는 다르다.

## 1. ERD (관계 개요)

```
Tenant 1───N User
Tenant 1───N Policy 1───N Chapter 1───N Section(선택) ┐
                          └────────────────────────── ├─N Article 1───N ArticleVersion 1───N VariableUsage N───1 Variable
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
| status | enum VersionStatus | draft/review/published/archived |
| changeNote | string? | 조문 단위 개정 사유. 시행 승인 시 필수 |
| reviewNote | string? | **반려 사유**(T-10). 되돌린 초안 카드에 그대로 보인다. 다시 검토 요청하면 지운다 — 남겨 두면 재제출 뒤에도 반려 상태처럼 보인다 |
| effectiveDate | date? | **이 버전이 시행된 날. 시점 조회(as-of)의 기준.** 승인 시 확정(미지정이면 승인일) |
| approvedBy / approvedAt | string?/datetime? | |
| createdBy | string? | |

인덱스: `[articleId, effectiveDate]` — 시점 조회에서 조문별 "기준일 이전 시행분 중 가장 최근"을 찾는 경로.

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

### Variable / VariableUsage (`variables` / `variable_usages`)
Variable: tenantId FK, key, label, defaultValue, description — `@@unique([tenantId, key])`.
VariableUsage: versionId FK → ArticleVersion, variableId FK → Variable — `@@unique([versionId, variableId])`.

### NotificationGroup / NotificationGroupMember (`notification_groups` / `notification_group_members`)
NotificationGroup: tenantId FK, name — `@@unique([tenantId, name])`.
NotificationGroupMember: 복합 PK `[groupId, userId]`, N:M 매핑 테이블.

### UserNotification (`user_notifications`)
tenantId FK, userId FK, kind(기본 "policy_revision"), title, body(text), policyId/articleId/versionId(참조용, FK 아님), readAt. 인덱스: `[userId, readAt, createdAt]`, `[tenantId, createdAt]`.

### AuditLog (`audit_logs`)
tenantId FK, userId FK?(SetNull), action, entityType, entityId, details(json).

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

## 3. 법령 개정 연계 (설계 — **아직 스키마에 없다**)

특허 명세서를 근거로 한 **설계안**이다. 실제 `schema.prisma` 에는 아직 없다.
전체 맥락·처리 흐름·API 는 [18_법령개정연계_설계](../18_법령개정연계_설계/법령개정연계_설계안.md)를 본다.

### 3.1 관계 개요

```
LawSource 1───N Law 1───N LawArticle ───┬─N LawChangeEvent
                                        │
                                        └─N LawLink N───1 Article   (사내 조문)
                                             ▲ tenantId 필수

LawChangeEvent 1───N AmendmentCandidate N───1 Article
                                        └──1 ArticleVersion (baseVersionId = 제1 조문)
                                        ▲ tenantId 필수

Variable 1───N VariableValue      (값별 유효기간·테넌트 범위)
Variable 1───N VariableUsage      (사용 위치 필드 추가)
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

#### LawSource (`law_sources`) — 법령원
id, code(unique, 예 `law.go.kr`), name, baseUrl, isActive.

#### Law (`laws`) — 법령, 테넌트 공용
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| sourceId | uuid FK → LawSource | |
| externalId | string | 법제처 MST(법령일련번호) |
| lawName / lawNo | string / string? | 법령명 / 법령번호 |
| promulgatedDate | date? | 공포일 |
| effectiveDate | date? | **법령 시행일** (≠ 사내 규정 시행일) |
| versionKey | string? | 현재 수신본의 지문. 바뀌면 개정 |
| lastCheckedAt | datetime? | 마지막 폴링 시각 |

`@@unique([sourceId, externalId])`, 인덱스 `[lastCheckedAt]`(폴링 대상 선정).

#### LawArticle (`law_articles`) — 법령조항, 테넌트 공용
lawId FK, articleNo(조), clauseNo(항, null 허용), itemNo(목, null 허용), title?, content(text), versionKey, effectiveDate?.
`@@unique([lawId, articleNo, clauseNo, itemNo])`, 인덱스 `[lawId]`.

**청구항의 "법령조항 식별자"가 이 레코드의 `id`** 다.

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

#### LawChangeEvent (`law_change_events`) — 변경 이벤트, 테넌트 공용
lawArticleId FK, beforeContent(text?), afterContent(text), beforeVersionKey?, afterVersionKey, promulgatedDate(공포일), lawEffectiveDate(법령 시행일), receivedVia(enum LawEventChannel: poll/manual/webhook — **수신경로**), detectedAt.
인덱스 `[lawArticleId, detectedAt]`, `[lawEffectiveDate]`.

#### AmendmentCandidate (`amendment_candidates`) — 후보 레코드 ⚠️ 테넌트별
| 필드 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK → Tenant (cascade) | **누락 금지** |
| articleId | uuid FK → Article | 영향 조문 |
| baseVersionId | uuid FK → ArticleVersion | **제1 조문** — 기준이 된 발행 버전 |
| changeEventId | uuid FK → LawChangeEvent | |
| candidateContent | text | **제2 조문** — 개정 후보 본문 |
| rationale | json | 변경 근거 정보 (관계유형·근거문구·확정상태·그래프 경로·생성방식·변수) |
| diff | json | 변경 전후 비교 정보 |
| generationMethod | enum AmendmentMethod | rule(규칙+템플릿) / llm(언어모델) |
| generationMeta | json? | 규칙·템플릿 id 또는 입력 원천·모델 정보 |
| confidence | float? | |
| reviewState | enum AmendmentState | draft/review/approved/rejected |
| reviewNote | text? | 반려 사유 |
| reviewedBy / reviewedAt | string? / datetime? | |
| resultVersionId | uuid? unique | 승인 후 만들어진 ArticleVersion |

인덱스 `[tenantId, reviewState, createdAt]`, `[tenantId, articleId]`, `[changeEventId]`.

**발행 버전은 승인 전까지 건드리지 않는다.** 후보를 별도 테이블에 두는 것만으로 청구항 5의 *"승인 정보를 수신하기 전까지 발행 버전의 본문을 유지"* 가 충족된다.

#### VariableValue (`variable_values`) — 변수 값 (신규)
variableId FK → Variable, tenantId?(null = 전역 기본값), value, validFrom(date), validTo(date?, null = 무기한).
인덱스 `[variableId, tenantId, validFrom]`.

> 기간이 겹치는 행을 DB 제약으로 막을 수 없다(Postgres `EXCLUDE` 는 Prisma 가 표현하지 못한다).
> **서비스 계층에서 겹침을 검사**하고, 조회는 `validFrom` 내림차순 첫 행을 쓴다.
> 겹침을 조용히 허용하면 어느 값이 적용됐는지 알 수 없게 되고, 그건 개정 초안의 신뢰를 통째로 무너뜨린다.

### 3.4 기존 테이블 변경

| 테이블 | 추가 필드 | 근거 |
|---|---|---|
| `Article` | `fingerprint String?` | 청구항 2 — 재파싱 시 조문 동일성 판정. 정규화 본문의 SHA-256 |
| `ArticleVersion` | `publishedAt DateTime?` | 청구항 7 — **발행일**. 현재는 `approvedAt`(승인 시각)·`effectiveDate`(시행일) 둘뿐 |
| `ArticleVersion` | `changeEventId String?` | 청구항 7 — 후속 버전을 변경 이벤트와 연결 |
| `ArticleVersion` | `sourceCandidateId String?` | 청구항 6 — 이 버전이 어느 후보에서 왔는지 (감사 추적) |
| `VariableUsage` | `occurrenceIndex Int`, `startOffset Int`, `endOffset Int`, `rawToken String` | 청구항 5 — **본문 내 사용 위치**. 현재는 `(versionId, variableId)` 뿐이라 "이 버전이 이 변수를 쓴다"는 사실만 안다. `@@unique` 가 `[versionId, variableId, occurrenceIndex]` 로 바뀐다 |

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
