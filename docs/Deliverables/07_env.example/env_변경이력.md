# .env.example 변경 이력

실제 파일은 저장소 루트의 `.env.example`이며, docker-compose와 npm 스크립트가 참조하므로 이 폴더로 옮기지 않습니다. 여기서는 변경 이력만 추적합니다. 루트 파일 수정 시 이 문서에 항목을 추가하세요.

## 현재 변수 (2026-07-20 기준, 루트 `.env.example` 그대로 옮김)

| 변수 | 용도 | 필수 여부 |
|------|------|-----------|
| `PUBLIC_URL` | 브라우저 접속 URL. CORS·docker-compose 치환에 사용 | 필수 |
| ~~`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`~~ | **삭제(T-136)** — 구글 로그인을 없앴다. 넣어 두어도 쓰지 않는다 | — |
| ~~`GOOGLE_CALLBACK_URL`~~ | **삭제(T-136)** | — |
| `VITE_PUBLIC_COMPANY_LEGAL_NAME` / `VITE_PUBLIC_COMPANY_REG_NO` | 웹 빌드 시 법인명·사업자등록번호 표시 | 선택 |

> 참고: `docker-compose.yml`에는 이 외에도 `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` 등이 직접 정의되어 있음 (`.env.example`에는 없음). 관련 위험은 [15_보안검토서](../15_보안검토서/보안_검토서.md) 참고.

## 변경 이력

| 일자 | 변경 내용 | 작성 |
|------|-----------|------|
| 2026-07-20 | 최초 기록 (루트 `.env.example` 현황 스냅샷) | - |
| 2026-09-07 | **백업 설정 6종 추가** — `BACKUP_S3_ENDPOINT`·`BACKUP_S3_BUCKET`·`BACKUP_S3_ACCESS_KEY`·`BACKUP_S3_SECRET_KEY`(필수), `BACKUP_S3_PREFIX`·`BACKUP_KEEP_DAYS`(선택). 규정 본문(DB)과 첨부파일이 둘 다 서버 안에만 있어 서버가 사라지면 같이 사라지던 문제. `scripts/backup-offsite.sh` 가 쓴다 | - |
| 2026-10-09 | **규정 질문(AI, T-130) 4종 추가** — `ANTHROPIC_API_KEY`(비우면 이 기능만 "설정 안 됨"), `AI_QA_MODEL`(기본 `claude-opus-5-5`), `AI_QA_MONTHLY_LIMIT`(회사별 월 한도, 기본 300 — 빈 값은 기본값으로 읽는다), `AI_QA_PROVIDER`(`mock` 이면 모의 AI, 통합 테스트용). docker-compose 도 넘긴다 | - |
| 2026-10-10 | **`AI_QA_USER_MONTHLY_LIMIT` 추가**(T-130 후속, 직원 한 명의 월 질문 한도, 기본 60) — 한 사람이 회사 한도를 다 쓰지 못하게. 회사 한도는 이제 AI 를 부르기 전에 센다(실패·거절도 셈) | - |
