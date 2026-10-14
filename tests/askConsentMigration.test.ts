import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 기존 회사를 끄는 것은 마이그레이션 한 번뿐이라 통합 시험(새로 만든 회사)으로는 확인되지 않는다 — 파일을 읽어 본다.
 * 배포 뒤에는 런북 7-9 의 읽기 전용 SQL(`SELECT count(*) FROM tenants WHERE ai_qa_enabled` → 0)로 확인한다.
 */
describe('규정 질문 기본 꺼짐 마이그레이션 (T-146)', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'apps', 'api', 'prisma', 'migrations', '20261014090000_ai_qa_consent', 'migration.sql'),
    'utf8',
  );

  it('새 회사의 기본값을 꺼짐으로 바꾸고, 기존 회사도 끈다', () => {
    expect(sql).toMatch(/ALTER TABLE "tenants" ALTER COLUMN "ai_qa_enabled" SET DEFAULT false;/);
    expect(sql).toMatch(/UPDATE "tenants" SET "ai_qa_enabled" = false WHERE "ai_qa_enabled" = true;/);
  });

  it('동의 기록 칸 셋을 더한다 — 판·시각·확인한 사람', () => {
    for (const col of ['ai_qa_notice_version" INTEGER', 'ai_qa_consented_at" TIMESTAMP(3)', 'ai_qa_consented_by" TEXT']) {
      expect(sql).toContain(col);
    }
  });
});
