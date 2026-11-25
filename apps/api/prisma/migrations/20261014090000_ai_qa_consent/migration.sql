-- T-146 규정 질문 국외이전 대응(D-09 재결정 2026-10-14, ADR-0025): 회사별 기본 꺼짐 + 관리자 동의 기록
-- 기존 회사도 끈다 — 고객사 관리자가 외부 전송 고지를 확인하기 전에는 질문이 외부로 나가지 않게.
-- (배포 시점 운영에는 AI 키가 없어 실제 전송은 없었다. 이미 꺼 둔 회사는 그대로다)
ALTER TABLE "tenants" ALTER COLUMN "ai_qa_enabled" SET DEFAULT false;
UPDATE "tenants" SET "ai_qa_enabled" = false WHERE "ai_qa_enabled" = true;

ALTER TABLE "tenants"
  ADD COLUMN "ai_qa_notice_version" INTEGER,
  ADD COLUMN "ai_qa_consented_at" TIMESTAMP(3),
  ADD COLUMN "ai_qa_consented_by" TEXT;
