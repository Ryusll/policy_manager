# 작업 방식 (바이브코딩 스타터 패키지 — 이 저장소에 맞춘 판)

<!-- 2026-10-12 스타터 패키지를 이 저장소에 옮겼다. 패키지의 requirements.md·backlog.json·CLI 자리는 SRS·작업관리대장이 맡는다. CLAUDE.md가 @.claude/vibe-starter.md 줄로 가져온다. -->

## 원본

- 무엇을 만드는가: SRS(`docs/Deliverables/03_SRS_요구사항명세/SRS_요구사항명세.md`)와 법령 개정 연계 설계(18). 왜 그렇게 정했는가: ADR(10).
- 무엇을 어디까지 했는가: 작업관리대장(`docs/Deliverables/17_작업관리대장/작업관리대장.md`) — 작업 T-, 완료 C-, 결정 대기 D-. 상태가 바뀌면 그 행을 바로 고친다.
- 요구가 바뀌면 SRS·대장을 먼저 고치고 작업으로 내린다. 사람이 정할 것(범위, 사업 결정, 되돌리기 어려운 변경)은 추측하지 않고 묻는다. 관례로 정할 수 있는 기본값은 스스로 정하고 알린다.

## 작업 순서

| 상황 | 부를 skill |
|---|---|
| 작업 하나 진행 (해설 → 구현·테스트 → 검토 → 커밋 → 대장 기록) | /task-cycle |
| 요구 추가·수정·철회, 결정(D-xx) 반영 | /requirement-change |
| 남의 줄이 섞인 파일·공유 문서에서 내 줄만 커밋 | /shared-commit |
| CLAUDE.md 맞추기 | /claude-md (사용자가 부름) |

## 서브에이전트

- 여러 파일에 걸친 기존 코드 파악은 직접 읽지 않는다. 위치는 Explore, 흐름은 code-explorer에 맡기고 요약과 파일:줄 목록만 받는다. 고칠 파일만 직접 연다.
- 작업을 시작하기 전에 task-explainer로 해설(완료 정의 해석·확인 방법·미결 질문)을 받는다.
- 대장에 완료로 기록하기 전에 adversarial-reviewer에게 변경 파일과 완료 정의를 넘겨 검토받는다. Critical·High는 고친 뒤 다시 검토받는다.

## 같은 트리를 쓰는 다른 세션

- 이 작업 트리는 여러 Claude 세션이 동시에 쓴다. 미커밋 변경이 내 것이 아닐 수 있다.
- 내 파일·줄만 커밋한다. stash·reset --hard·checkout·브랜치 전환을 하지 않는다. 격리가 필요하면 scratchpad에 worktree를 만든다.
- docker·개발 서버는 공용이다. 넓은 pkill을 쓰지 않고, 재시작 전후에 다른 세션에 알린다.

## hook이 막을 때

막힌 이유를 읽고 안내대로 고친다. 사용자가 요청하지 않았다면 hook·settings.json·hooks.config.json을 고쳐 우회하지 않는다.

| hook | 막거나 알리는 것 | 할 일 |
|---|---|---|
| git-guard | 남의 작업까지 바꾸는 git 명령, 남의 줄·로컬 전용 파일·비밀값 커밋 | 경로를 적어 내 것만 올린다, /shared-commit |
| size-guard | 300줄 초과, 이미 넘은 파일의 150줄 넘는 증가 | 새 파일로 나눈다 |
| check-runner | 마무리 전 typecheck·단위 테스트·lint·hooks 테스트 실패 | 고친다(다른 세션 변경 탓이면 보고) |
| done-gate | 검토 없이 대장 T 행을 완료로 바꿈 | adversarial-reviewer 검토 |
| agent-guard | 에이전트의 파일 쓰기, git 조회 밖의 명령 | 메인 대화가 한다 |
| context-guard | 메인 대화의 많은 직접 읽기 | Explore·code-explorer에 맡긴다 |
| rule-loader | 규칙을 받기 전 새 파일 쓰기 | 규칙을 반영해 다시 쓴다 |
| claude-md-check | CLAUDE.md의 없는 참조·크기·비밀값 | 안내대로 고친다 |

## 여기에 적지 않는 것

- 경로별 지침은 .claude/rules/에 있고, 맞는 파일을 읽을 때 들어온다.
- 브랜치·미커밋 수·대장 다음 번호·최근 마이그레이션은 session-start hook과 상태 줄이 알려 준다.
