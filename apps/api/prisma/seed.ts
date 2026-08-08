import { PrismaClient, Role, PlanTier } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// 시점 조회(as-of) 데모용 시행일. 제정 시점과 개정 시점이 갈려 있어야
// 기준일을 옮겼을 때 본문이 실제로 달라지는 것을 확인할 수 있다.
const ENACTED_ON = new Date(Date.UTC(2025, 0, 1)); // 2025-01-01 제정
const AMENDED_ON = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01 일부개정

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'astrum' },
    update: {},
    create: {
      name: 'Astrum Platform',
      slug: 'astrum',
      plan: PlanTier.enterprise,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'admin@astrum.com' } },
    update: {
      passwordHash,
      name: 'Astrum Platform Admin',
      role: Role.admin,
      platformRole: 'global_admin',
    },
    create: {
      tenantId: platformTenant.id,
      email: 'admin@astrum.com',
      passwordHash,
      name: 'Astrum Platform Admin',
      role: Role.admin,
      platformRole: 'global_admin',
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo',
      plan: PlanTier.pro,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {
      passwordHash,
      name: 'Admin User',
      role: Role.admin,
      platformRole: 'none',
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      passwordHash,
      name: 'Admin User',
      role: Role.admin,
      platformRole: 'none',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'editor@demo.com' } },
    update: {
      passwordHash,
      name: 'Editor User',
      role: Role.editor,
    },
    create: {
      tenantId: tenant.id,
      email: 'editor@demo.com',
      passwordHash,
      name: 'Editor User',
      role: Role.editor,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'viewer@demo.com' } },
    update: {
      passwordHash,
      name: 'Viewer User',
      role: Role.viewer,
    },
    create: {
      tenantId: tenant.id,
      email: 'viewer@demo.com',
      passwordHash,
      name: 'Viewer User',
      role: Role.viewer,
    },
  });

  // Remove legacy sample so only DEMO-01 remains.
  await prisma.policy.deleteMany({
    where: {
      tenantId: tenant.id,
      code: { in: ['POL-001', 'TEST-001', 'test-001'] },
    },
  });

  const policy = await prisma.policy.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'DEMO-01' } },
    update: {
      title: '(SAMPLE) 정보보안규정',
      description: '샘플 데이터입니다. 정보보안 운영 절차와 책임 기준을 예시로 제공합니다.',
      metadata: {
        department: '정보보안팀',
        category: '정보보안',
      },
    },
    create: {
      tenantId: tenant.id,
      code: 'DEMO-01',
      title: '(SAMPLE) 정보보안규정',
      description: '샘플 데이터입니다. 정보보안 운영 절차와 책임 기준을 예시로 제공합니다.',
      metadata: {
        department: '정보보안팀',
        category: '정보보안',
      },
    },
  });

  // Keep sample policy deterministic on each seed run.
  await prisma.chapter.deleteMany({
    where: { policyId: policy.id },
  });

  const chapterGeneral = await prisma.chapter.create({
    data: {
      policyId: policy.id,
      number: 1,
      title: '총칙',
    },
  });

  const articlePurpose = await prisma.article.create({
    data: {
      chapterId: chapterGeneral.id,
      number: 1,
      title: '목적',
    },
  });

  await prisma.articleVersion.create({
    data: {
      articleId: articlePurpose.id,
      versionNum: 1,
      content:
        '이 규정은 회사의 정보자산을 보호하고, 임직원이 준수해야 할 정보보안의 기본 원칙과 절차를 정함을 목적으로 한다.',
      status: 'published',
      effectiveDate: ENACTED_ON,
      changeNote:
        '제정 시 최초 시행.',
    },
  });

  const articleScope = await prisma.article.create({
    data: {
      chapterId: chapterGeneral.id,
      number: 2,
      title: '적용범위',
    },
  });

  await prisma.articleVersion.create({
    data: {
      articleId: articleScope.id,
      versionNum: 1,
      content:
        '이 규정은 회사의 모든 임직원, 파견인력, 외주 인력 및 회사 정보시스템에 접근하는 제3자에게 적용한다.',
      status: 'published',
      effectiveDate: ENACTED_ON,
      changeNote:
        '제정 시 최초 시행.',
    },
  });

  const chapterOperation = await prisma.chapter.create({
    data: {
      policyId: policy.id,
      number: 2,
      title: '보안 운영',
    },
  });

  // 조 번호는 장이 바뀌어도 문서 전체에서 이어진다(제1장이 제1·2조 → 제2장은 제3조부터).
  const articleAccount = await prisma.article.create({
    data: {
      chapterId: chapterOperation.id,
      number: 3,
      title: '계정 및 접근권한 관리',
    },
  });

  await prisma.articleVersion.create({
    data: {
      articleId: articleAccount.id,
      versionNum: 1,
      content:
        '정보시스템 계정은 개인별로 발급하며 공유를 금지한다. 권한은 최소권한 원칙에 따라 부여하고, 인사이동 또는 퇴직 시 즉시 조정한다.',
      status: 'published',
      effectiveDate: AMENDED_ON,
      changeNote:
        '보안 운영 절차 정비에 따른 일부개정.',
    },
  });

  const articleIncident = await prisma.article.create({
    data: {
      chapterId: chapterOperation.id,
      number: 4,
      title: '보안사고 대응',
    },
  });

  await prisma.articleVersion.create({
    data: {
      articleId: articleIncident.id,
      versionNum: 1,
      content:
        '보안사고가 의심되거나 발생한 경우 즉시 보안담당자에게 보고하여야 하며, 초기 대응·원인 분석·재발 방지 조치를 사고 대응 절차에 따라 수행한다.',
      status: 'published',
      effectiveDate: AMENDED_ON,
      changeNote:
        '보안 운영 절차 정비에 따른 일부개정.',
    },
  });

  // 제정·개정 이유(개정문) — 문서 차수별 기록
  await prisma.policyRevisionReason.deleteMany({ where: { policyId: policy.id } });
  await prisma.policyRevisionReason.createMany({
    data: [
      {
        policyId: policy.id,
        kind: 'enactment',
        label: '제정',
        reason:
          '회사 정보자산 보호를 위한 기본 원칙과 임직원 준수사항을 정하기 위하여 본 규정을 제정함.',
        promulgatedDate: ENACTED_ON,
        effectiveDate: ENACTED_ON,
      },
      {
        policyId: policy.id,
        kind: 'amendment',
        label: '제1차 일부개정',
        reason:
          '계정 관리 및 보안사고 대응 절차가 실무와 어긋나는 부분이 있어 이를 정비하고, 최소권한 원칙을 명문화하기 위함.',
        summary: '가. 계정 및 접근권한 관리 조항 신설\n나. 보안사고 대응 절차 구체화',
        promulgatedDate: new Date(Date.UTC(2026, 1, 15)),
        effectiveDate: AMENDED_ON,
      },
    ],
  });

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });