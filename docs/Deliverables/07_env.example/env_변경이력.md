# .env.example 변경 이력

실제 파일은 저장소 루트의 `.env.example`이며, docker-compose와 npm 스크립트가 참조하므로 이 폴더로 옮기지 않습니다. 여기서는 변경 이력만 추적합니다. 루트 파일 수정 시 이 문서에 항목을 추가하세요.

## 현재 변수 (2026-07-20 기준, 루트 `.env.example` 그대로 옮김)

| 변수 | 용도 | 필수 여부 |
|------|------|-----------|
| `PUBLIC_URL` | 브라우저 접속 URL. CORS·OAuth 콜백·docker-compose 치환에 사용 | 필수 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 로그인 | Google 로그인 사용 시 |
| `GOOGLE_CALLBACK_URL` | 콜백 URL이 `${PUBLIC_URL}/api/auth/google/callback`과 다를 때만 | 선택 |
| `VITE_PUBLIC_COMPANY_LEGAL_NAME` / `VITE_PUBLIC_COMPANY_REG_NO` | 웹 빌드 시 법인명·사업자등록번호 표시 | 선택 |

> 참고: `docker-compose.yml`에는 이 외에도 `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` 등이 직접 정의되어 있음 (`.env.example`에는 없음). 관련 위험은 [15_보안검토서](../15_보안검토서/보안_검토서.md) 참고.

## 변경 이력

| 일자 | 변경 내용 | 작성 |
|------|-----------|------|
| 2026-07-20 | 최초 기록 (루트 `.env.example` 현황 스냅샷) | - |
| 2026-09-07 | **백업 설정 6종 추가** — `BACKUP_S3_ENDPOINT`·`BACKUP_S3_BUCKET`·`BACKUP_S3_ACCESS_KEY`·`BACKUP_S3_SECRET_KEY`(필수), `BACKUP_S3_PREFIX`·`BACKUP_KEEP_DAYS`(선택). 규정 본문(DB)과 첨부파일이 둘 다 서버 안에만 있어 서버가 사라지면 같이 사라지던 문제. `scripts/backup-offsite.sh` 가 쓴다 | - |
