---
paths:
  - "docker-compose*.yml"
  - "apps/*/Dockerfile"
  - "apps/*/docker-entrypoint.sh"
  - "apps/web/nginx.conf"
  - "scripts/oracle/**"
  - ".github/**"
  - ".env*"
---

# 배포·인프라 파일

- 로컬 전용 파일(`docker-compose.override.yml`, `scripts/dev-local.sh`, package.json의 `dev:local`, OracleCloud 신규구축 절차서)은 커밋하지 않는다. git-guard hook이 막는다.
- 인프라 파일 중 추적되지 않거나 고쳐진 채 남아 있는 것은 다른 세션·사람의 진행 중 작업이다. 내 변경이 아니면 커밋하지 않는다.
- 환경 변수를 더하거나 바꾸면 `.env.example`과 `docs/Deliverables/07_env.example` 변경이력, 배포 영향이 있으면 Runbook(16)을 함께 고친다.
- 비밀값은 `.env`에만 둔다. 화면·로그·대화에 값을 보일 때는 가린다.
- 운영 서버는 읽기 전용 점검까지만 직접 한다. 서버 쓰기·운영 DB 조회·방화벽 변경은 사용자에게 실행할 명령을 건넨다.
- 배포 패키지는 HEAD를 깨끗하게 꺼낸 트리로 만들고, 서버에 남은 지운 파일을 정리한다(Runbook 7-8).
