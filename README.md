# policy_manager (규정관리 시스템)

법령정보센터 수준의 규정 편집·열람 경험을 목표로 하는 멀티테넌트 SaaS 규정관리 시스템입니다. 회사(테넌트)별로 규정을 조·항·목(條·項·目) 구조로 관리하고, 개정 워크플로·통합검색·출력 템플릿·팀 알림을 제공합니다.

## 기술 스택

- **프론트엔드**: React 18, Vite, TanStack Query, Zustand, Tailwind CSS, react-router-dom (`apps/web`)
- **백엔드**: NestJS, Prisma, PostgreSQL (`apps/api`)
- **인프라**: Docker Compose — postgres, redis, minio(파일 스토리지), api, web (nginx)
- **인증**: JWT (access/refresh) + Google OAuth

## 프로젝트 구조

```
apps/
  api/     NestJS 백엔드 (모듈별 폴더: policies, versions, templates, billing, platform-admin ...)
  web/     React 프론트엔드 (pages, components, stores, hooks, api)
docker-compose.yml
docs/
  Deliverables/   문서 산출물 (프로젝트기획서, SRS, ERD, API 명세서 등)
```

## 로컬 개발 환경 실행

### 1) Docker Compose로 전체 실행

```bash
cp .env.example .env
# 필요 시 .env에 GOOGLE_CLIENT_ID/SECRET, VITE_PUBLIC_COMPANY_* 값 채우기
npm run docker:up
```

- web: http://localhost (nginx, 80번 포트)
- api: http://localhost:3001 (`/api` 프리픽스, Swagger는 `/api/docs`)
- 컨테이너 기동 시 API가 자동으로 `prisma migrate deploy` → 실패 시 `prisma db push` → 데모 시드(`admin@demo.com` / `password123`)를 실행합니다.

### 2) 로컬에서 직접 실행 (Docker 없이 API/웹만)

```bash
npm install
npm run dev   # apps/api + apps/web 동시 실행 (concurrently)
```

- web: http://localhost:5173 (Vite dev server)
- api: 별도 실행 시 `apps/api`에서 `npm run dev`

로컬 실행 시 PostgreSQL/Redis/MinIO는 별도로 띄우거나 `docker compose up -d postgres redis minio`로 의존 서비스만 올려서 사용합니다.

## 주요 npm 스크립트 (루트)

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | api + web 동시 개발 서버 실행 |
| `npm run build` | api + web 순차 빌드 |
| `npm run docker:up` / `docker:down` | Docker Compose 기동/종료 |
| `npm run docker:logs` | 컨테이너 로그 tail |
| `npm run docker:build` | 이미지 재빌드 |

## 문서

프로젝트 산출물은 [`docs/Deliverables`](docs/Deliverables/README.md)에서 문서 종류별로 관리합니다 (프로젝트 기획서, SRS, 시스템 아키텍처, ERD, API 명세서, 화면설계서, 기술부채 대장, 보안 검토서, Runbook 등). 신규 문서 작성·개정 시 해당 폴더의 버전 규칙을 따르세요.

기존 개발 이력 문서는 `docs/v1.md` ~ `v3.md`, `docs/policy_manager_개발정의서.docx`, `docs/VEDA_FeatureList.docx`를 참고하세요.
