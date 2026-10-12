# VEDA 규정관리 (policy_manager)

<!-- 근거: README, SRS, 개발컨벤션, package.json. /claude-md 로 맞춘다. 100줄 이하(권장), 가져오는 파일과 합쳐 200줄 이하. 공개 저장소 — 운영 주소·비밀값을 쓰지 않는다. -->

@.claude/vibe-starter.md

## 이 프로젝트

아스트룸(회사)의 VEDA(솔루션). 기업의 사내 규정을 장·절·조(조문 안은 항·호·목) 구조로 편집·개정·열람하는 멀티테넌트 B2B SaaS다.
핵심 기능은 법령 개정 → 사내 규정 개정 추천이다(특허 명세서 근거, SRS 12절, 대장 S7). 법제처 법령 동기화 → 영향받는 조문의 개정 후보 → 사람 검토·승인 → 시행일이 있는 버전으로 이어진다.
고객사와 첫 관리자는 아스트룸이 통합 관리자 화면에서 개설하고, 고객사 관리자가 직원 계정을 발급한다. 공개 회원가입·구글 로그인은 없다.
사용자: 고객사 규정 담당(admin·editor), 직원(viewer), 아스트룸 운영자(global_admin).

## 범위

- 포함: SRS 1~13절. 알려진 미구현·제외는 SRS 14절.
- 가격·결제는 보류(D-02·D-03)다. 임시 운영 방침(T-125)에 따라 요금제 창은 "아스트룸에 문의"이고, 요금제 변경은 플랫폼 관리자만 한다. 결제 화면을 만들지 않는다.
- 대장·SRS에 없는 기능은 만들지 않고 /requirement-change 를 권한다.

## 용어

| 용어 | 뜻 | 혼동 주의 |
|---|---|---|
| 규정 / 조문 | 회사 규정(Policy)과 그 조(Article) | 법령(Law)은 국가 법령, 테넌트 공용 데이터 |
| 버전 | 조문의 한 판: draft → review → published → archived | 시행일(효력)·발행일(승인)·공포일은 서로 다르다 |
| 시행 예정 | 시행일이 미래인 발행 버전 | "현재"는 오늘 시행 중인 판 |
| 개정 후보 | 법령 개정이 영향을 준 조문의 개정 초안 | 사람 승인으로만 버전이 된다(자동 발행 없음) |
| 법령 관계 | 조문 ↔ 법령 조항 연결(LawLink) | 확정(confirmed)만 개정 후보를 만든다, 추천(suggested)은 아니다 |
| 테넌트 | 고객사 조직, 데이터 경계 | 플랜(Starter 10명 / Pro 50명 / Enterprise)은 사용자 상한 등 |

## 환경

- npm workspaces: `apps/api`(NestJS 10, Prisma 5, PostgreSQL 15), `apps/web`(React 18, Vite, TanStack Query, zustand, Tailwind). CI·Dockerfile은 Node 20, hooks 테스트는 Node 22 이상.
- 로컬 전체 실행: `npm run docker:up` → web :80, api :3001(경로 앞에 /api). 통합 테스트는 docker API(:3001)를 부른다.
- 외부 연동: 법제처 OPEN API(법령 동기화), Anthropic API(규정 질문 — 키가 없으면 안내만 한다).
- 운영: Oracle Cloud 서버 한 대(docker compose). 절차는 `docs/Deliverables/16_Runbook_배포롤백` — 서버 쓰기는 사용자가 실행한다.

## 명령

| 명령 | 용도 | 성공 기준 |
|---|---|---|
| `npm run typecheck` | api·web 타입 검사 | 오류 0 |
| `npm run lint` | eslint(타입 정보 룰 포함) | 오류 0, 경고 수가 늘지 않음 |
| `npm test` | 단위 테스트(`tests/*.test.ts`) | 전체 통과 |
| `npm run test:int` | 통합 테스트(`tests/integration`, docker API 필요) | 전체 통과 |
| `npm run build` | api·web 빌드 | 성공 |
| `node --test ".claude/hooks/*.test.mjs"` | hooks·에이전트·skill·규칙·CLAUDE.md 검사 | 전체 통과 |

## 주의할 점

- 공개 저장소(GitHub)다. 비밀값은 `.env`에만 두고, 운영 서버 주소·IP는 어디에도 커밋하지 않는다.
- develop 브랜치 하나로 운영한다(D-04). push는 사용자가 요청할 때만 한다.
- 커밋 메시지: `feat|fix|perf|refactor|test|docs|chore: 한국어 설명 (T-xxx)`.
- 한국어 문서·보고는 번역투 없이 자연스럽게 쓴다.
