---
name: claude-md
description: 프로젝트 루트의 CLAUDE.md를 만들거나, 개요·범위·환경·명령·작업 방식이 바뀐 뒤 CLAUDE.md를 맞춘다. 사용자가 부를 때만 쓴다.
disable-model-invocation: true
---

# CLAUDE.md 만들기·맞추기

CLAUDE.md에는 모든 세션에 필요한 사실만 둔다. 작업 방식은 `.claude/vibe-starter.md`(가져오기), 절차는 skill, 경로별 지침은 `.claude/rules/`, 진행 상태는 작업관리대장과 session-start hook이 맡는다.

## 크기

- CLAUDE.md는 **100줄 이하**(권장), 가져오는 파일과 합쳐 **200줄을 절대 넘기지 않는다**. claude-md-check hook이 200줄 초과를 막고 100줄 초과를 알린다.

## 시작 전 확인

- CLAUDE.md가 이미 있으면 새로 쓰지 않는다. 근거 문서와 다른 곳을 "절 / 지금 / 바꿀 내용 / 근거" 표로 보여 주고, 승인받은 것만 고친다.

## 근거 문서

| 절 | 근거 |
|---|---|
| 이 프로젝트 | `README.md`, `docs/Deliverables/01_프로젝트기획서`, SRS 머리말 |
| 범위 | SRS 14절(범위 밖), 대장 "결정 대기" |
| 용어 | SRS·화면설계서에 나오는 말 중 코드와 화면에 쓰이는 것만 |
| 환경·명령 | `package.json` scripts, `docker-compose.yml`, 개발컨벤션 4·7절 — 실제로 실행해 확인한 명령만 |
| 주의할 점 | 개발컨벤션·코드리뷰체크리스트 중 코드만 보고 알 수 없는 것, 반복된 사고 |

## 작성 규칙

- 폴더 트리, 의존성 목록, rule·skill에 이미 있는 내용, 진행 상태는 쓰지 않는다.
- **공개 저장소다**: 운영 서버 주소·IP, 비밀값, 개인 계정은 쓰지 않는다.
- 문서에 없는 내용은 지어내지 않고 사용자에게 묻는다.

## 확인

1. `node --test .claude/hooks/setup.test.mjs`가 통과해야 한다(CLAUDE.md 검사 포함).
2. 사용자에게 새 세션에서 `/context`를 열어 Memory files에 CLAUDE.md와 vibe-starter.md가 보이는지 확인하라고 안내한다.
3. 보고: 절마다 옮긴 근거 위치를 표로 보여 주고, 사용자에게 물어 채운 값은 따로 적는다.
