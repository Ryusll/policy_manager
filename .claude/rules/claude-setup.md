---
paths:
  - ".claude/**"
  - "CLAUDE.md"
---

# Claude Code 설정 (.claude/, CLAUDE.md)

- 사용자가 직접 요청하지 않았다면, hook이 막은 작업을 통과시키려고 hook 스크립트, settings.json, hooks.config.json, 규칙, skill을 고치지 않는다. 막힌 이유를 사용자에게 알리고 지시를 받는다.
- 기준값(줄 수, 검사 명령, 에이전트 권한, 완료 관문, 로컬 전용 파일, CLAUDE.md 크기)은 hooks.config.json에서 바꾸고, 바뀐 값에 맞춰 규칙 문장도 고친다.
- .claude/ 아래를 고친 뒤에는 테스트를 실행한다: `node --test ".claude/hooks/*.test.mjs"` (Node 22 이상)
- 규칙, skill, 에이전트 문서에는 실제로 있는 명령, 파일, 에이전트만 적는다.
- settings.json과 hooks는 같은 트리를 쓰는 모든 세션에 걸린다. 바꾸기 전에 다른 세션에 알린다.
- CLAUDE.md는 100줄 이하(권장), 가져오는 파일과 합쳐 200줄을 넘기지 않는다.
