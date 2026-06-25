const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('password123', 10);

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: '데모 기관', slug: 'demo', plan: 'starter' },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: { tenantId: tenant.id, email: 'admin@demo.com', passwordHash: hash, name: '관리자', role: 'admin' },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'editor@demo.com' } },
    update: {},
    create: { tenantId: tenant.id, email: 'editor@demo.com', passwordHash: hash, name: '편집자', role: 'editor' },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'viewer@demo.com' } },
    update: {},
    create: { tenantId: tenant.id, email: 'viewer@demo.com', passwordHash: hash, name: '열람자', role: 'viewer' },
  });

  console.log('시드 완료');
}

main().catch(console.error).finally(() => prisma.$disconnect());
