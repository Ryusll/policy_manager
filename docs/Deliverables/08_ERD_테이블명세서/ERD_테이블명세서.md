# ERD + 테이블 명세서

작성일: 2026-07-21
근거: `apps/api/prisma/schema.prisma` (실제 스키마 전문 반영)

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
Tenant 1───N AuditLog, ExportJob, PolicyImportLog
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

### ExportJob (`export_jobs`)
tenantId FK, status, fileUrl, finishedAt. **DB 스키마만 존재** — `ExportModule`은 빈 모듈이고 이 테이블을 참조하는 코드가 전혀 없음 ([03_SRS 13.1](../03_SRS_요구사항명세/SRS_요구사항명세.md) 참고).

### PolicyImportLog (`policy_import_logs`)
tenantId FK, userId FK?, policyId FK?, sourceName, parseProfile, chapterCount, articleCount, cleanupOptions(json), status, message. 인덱스: `[tenantId, createdAt]`.

### RegulationParseSession (`regulation_parse_sessions`)
tenantId FK, userId FK?, fileName, mimeType, status(기본 "pending"), extractedText(text), extractMeta(json), parseTree(json), errorMessage, committedPolicyId FK? → Policy(관계명 CommittedParsePolicy). 인덱스: `[tenantId, createdAt]`.

### PlatformBranding (`platform_branding`)
테넌트 무관 단일 행(SaaS 운영사 표기). id, legalName, registrationNo, productLabel(기본 "Policy Manager"), logoDataUrl, lockupImageSrc.

> **주의**: 아래 Billing 3개 테이블(`BillingCustomer`/`BillingSubscription`/`BillingPayment`)은 스키마에만 존재하며 현재 애플리케이션 코드에서 읽거나 쓰지 않는다. 결제 처리는 `tenant.plan` 갱신 + 감사 로그만 수행한다 ([03_SRS 13.1](../03_SRS_요구사항명세/SRS_요구사항명세.md) 참고).

### BillingCustomer (`billing_customers`)
tenantId FK, unique — 테넌트당 1행. provider(기본 "mock"), providerCustomerId.

### BillingSubscription (`billing_subscriptions`)
tenantId FK, billingCustomerId FK?(SetNull), provider, providerSubscriptionId, plan(PlanTier), status(SubscriptionStatus: active/trial/canceled/expired), startedAt, currentPeriodStart/End, canceledAt. 인덱스: `[tenantId, status]`, `[provider, providerSubscriptionId]`, `[currentPeriodEnd]`.

### BillingPayment (`billing_payments`)
tenantId FK, billingCustomerId FK?, subscriptionId FK?, provider, providerPaymentId, providerOrderId, amount(int), currency(기본 "KRW"), status(PaymentStatus: succeeded/failed/refunded), paidAt, refundAt, metadata(json). 인덱스: `[tenantId, createdAt]`, `[status, paidAt]`, `[provider, providerPaymentId]`.

## 3. 참고
- 모든 타임스탬프는 `createdAt`(default now) / `updatedAt`(@updatedAt) 패턴 일관 적용
- 테넌트 격리는 각 모델의 `tenantId` FK(대부분 `onDelete: Cascade`)로 이루어지며, DB 레벨 Row-Level Security는 적용되어 있지 않음 — 애플리케이션 코드가 매 쿼리에 `tenantId` 필터를 직접 걸어야 함 (누락 시 테넌트 간 데이터 노출 위험, [15_보안검토서](../15_보안검토서/보안_검토서.md) 참고)
- 스키마 변경 이력(마이그레이션 파일 12건)은 [04_시스템아키텍처](../04_시스템아키텍처/시스템아키텍처.md) 5절 참고
