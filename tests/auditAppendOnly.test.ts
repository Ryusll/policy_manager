import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 감사 로그는 추가만 한다(T-178, PAT-21 — 특허 도 12). 앱에 감사 기록을 고치거나 지우는 경로가 생기면 여기서 걸린다 — 정정은 원 기록을
 * 가리키는 후속 기록(`audit/audit-correction.ts` 의 writeCorrection)으로만 남긴다.
 *
 * 코드를 훑는 검사라 모든 길을 막지는 못한다(문자열을 이어 붙인 날 SQL 등). DB 수준 강제(트리거·권한)와 보관·파기는 D-19 —
 * 그 전까지는 여기 잡히는 꼴을 넓혀 간다: Prisma 수정·삭제 호출(점·대괄호), 다른 모델에서 감사 관계로 들어가는 중첩 쓰기, 스키마를
 * 붙인 날 SQL, 정정 대상을 쓰는 곳.
 */

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'apps', 'api', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/** 주석을 지운 코드 — 설명에 적힌 낱말은 세지 않는다 */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const sources = () => tsFiles(SRC).map((f) => ({ rel: relative(SRC, f), code: stripComments(readFileSync(f, 'utf8')) }));

/** 스키마에서 감사 기록을 가리키는 관계 필드 이름 — Tenant·User 의 auditLogs, AuditLog 의 corrects·correctedBy 등 */
const auditRelationFields = () => {
  const schema = readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8');
  return [...new Set([...schema.matchAll(/^[ \t]+(\w+)[ \t]+AuditLog(\[\]|\?)?(?=\s)/gm)].map((m) => m[1]))].sort();
};

const NESTED_VERBS = 'update|updateMany|upsert|delete|deleteMany|set|connect|disconnect|connectOrCreate';
/** 감사 클라이언트로 허락한 것 — 추가와 조회 메서드를 바로 부르는 것, 트랜잭션 타입 표기, 변수 서비스의 감사 도우미(this.auditLog) */
const ALLOWED_AUDIT_USE = [
  /\bauditLog\s*\??\.\s*(create|createMany|findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\s*\(/g,
  /Pick<\s*Prisma\.TransactionClient\s*,\s*(['"`])auditLog\1\s*>/g,
  /\bthis\.auditLog\s*\(/g,
  /\basync\s+auditLog\s*\(/g,
];
/**
 * 감사 클라이언트를 허락한 꼴 밖에서 만지는 곳 — tx.auditLog.update(·tx.auditLog?.update(·tx['auditLog']·별칭(const logs = tx.auditLog)
 * 모두. 허락한 꼴을 지우고 남은 auditLog 낱말을 센다
 */
const auditClientMisuse = (code: string) => {
  const rest = ALLOWED_AUDIT_USE.reduce((c, re) => c.replace(re, ' '), code);
  return [...rest.matchAll(/\bauditLog\b.{0,30}/g)].map((m) => m[0]);
};
/** 날 SQL — UPDATE·DELETE FROM·TRUNCATE·DROP TABLE·ALTER TABLE·MERGE INTO(ONLY·스키마·따옴표 이름까지), 덮어쓰는 INSERT … ON CONFLICT DO UPDATE */
const RAW_WRITE =
  /\b(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?|DROP\s+TABLE(\s+IF\s+EXISTS)?|ALTER\s+TABLE|MERGE\s+INTO)\s+(ONLY\s+)?(?:"?\w+"?\s*\.\s*)?"?audit_logs"?|\bINSERT\s+INTO\s+(?:"?\w+"?\s*\.\s*)?"?audit_logs"?[\s\S]{0,400}?\bON\s+CONFLICT\b[\s\S]{0,200}?\bDO\s+UPDATE\b/gi;
/**
 * 다른 모델에서 감사 관계로 들어가는 중첩 쓰기 — tenant.update({ data: { auditLogs: { deleteMany } } }), corrects: { connect }. 관계 필드 뒤
 * 객체를 괄호 짝까지 잘라 안쪽 괄호를 비우고, 바로 아래 키 자리(따옴표 키·단축 속성 포함, 앞에 배열·객체 값이 있어도)에 쓰기 동사가
 * 있는지 본다. 값 자리의 같은 낱말(where: set)은 세지 않는다
 */
const nestedWrites = (code: string, fields: string[]) => {
  const found: string[] = [];
  for (const m of code.matchAll(new RegExp(`\\b(${fields.join('|')})\\s*:\\s*\\{`, 'g'))) {
    const open = m.index + m[0].length;
    let i = open;
    for (let depth = 1; i < code.length && depth > 0; i++) depth += code[i] === '{' ? 1 : code[i] === '}' ? -1 : 0;
    let body = code.slice(open, i - 1);
    for (let prev = ''; prev !== body; ) [prev, body] = [body, body.replace(/\{[^{}[\]]*\}|\[[^{}[\]]*\]/g, '')];
    const verb = body.match(new RegExp(`(?:^|,)\\s*['"]?\\b(${NESTED_VERBS})\\b['"]?\\s*(?::|,|$)`));
    if (verb) found.push(`${m[1]}: { ${verb[1]} }`);
  }
  return found;
};
const writesIn = (code: string, fields: string[]) => [...auditClientMisuse(code), ...[...code.matchAll(RAW_WRITE)].map((m) => m[0]), ...nestedWrites(code, fields)];

describe('감사 로그는 추가만 (T-178)', () => {
  it('스키마의 감사 관계 필드를 찾는다(검사 꼴이 비지 않게)', () => {
    expect(auditRelationFields()).toEqual(['auditLogs', 'correctedBy', 'corrects']);
  });

  it('앱 코드에 감사 기록을 고치거나 지우는 호출이 없다', () => {
    const fields = auditRelationFields();
    const found = sources().flatMap(({ rel, code }) => writesIn(code, fields).map((w) => `${rel}: ${w}`));
    expect(found).toEqual([]);
  });

  it('정정 대상(correctsId·corrects·correctedBy)을 다루는 곳은 정정 도우미와 조회 서비스뿐이고, 조회 서비스는 쓰지 않는다', () => {
    const touching = sources()
      .filter(({ code }) => /correctsId|corrects_id|\bcorrects\b|\bcorrectedBy\b/.test(code))
      .map(({ rel }) => rel)
      .sort();
    expect(touching).toEqual([join('audit', 'audit-correction.ts'), join('audit', 'audit-log.service.ts')]);
    const reader = sources().find(({ rel }) => rel === join('audit', 'audit-log.service.ts'))!.code;
    expect(reader.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\b(connect|disconnect|connectOrCreate)\b|\$executeRaw/g)).toBeNull();
    const writer = sources().find(({ rel }) => rel === join('audit', 'audit-correction.ts'))!.code;
    expect(writer.match(/\bauditLog\s*\.\s*(\w+)\s*\(/g)?.map((m) => m.replace(/\s+/g, ''))).toEqual(['auditLog.create(', 'auditLog.findFirst(', 'auditLog.findFirst(', 'auditLog.findFirst(', 'auditLog.findFirst(']);
  });

  it('가드가 실제로 잡는다 — 예시 코드', () => {
    const fields = auditRelationFields();
    const bad = [
      'await tx.auditLog.update({ where: { id }, data: {} })',
      'this.prisma.auditLog.deleteMany({ where: { tenantId } })',
      'await tx.auditLog . upsert({})',
      "await tx['auditLog'].update({ where: { id } })",
      'await tx.$executeRaw`UPDATE audit_logs SET details = null`',
      'await tx.$executeRawUnsafe(\'DELETE FROM "audit_logs" WHERE id = $1\', id)',
      'await tx.$executeRaw`UPDATE public.audit_logs SET user_id = NULL`',
      'await tx.$executeRawUnsafe(\'DELETE FROM "public"."audit_logs"\')',
      "sql('TRUNCATE TABLE audit_logs')",
      'await tx.tenant.update({ where: { id }, data: { auditLogs: { deleteMany: {} } } })',
      'await tx.user.update({ where: { id }, data: { auditLogs: { set: [] } } })',
      'await tx.auditLog.create({ data: { action, corrects: { connect: { id: orig } } } })',
      // 재검토(10/24)가 찾은 우회 — 별칭, 옵셔널 체이닝, ONLY, 배열을 지난 중첩 쓰기, 덮어쓰는 INSERT
      'const logs = tx.auditLog; await logs.deleteMany({})',
      'await tx.auditLog?.update({ where: { id } })',
      "await tx.$executeRawUnsafe('DELETE FROM ONLY audit_logs')",
      'await tx.$executeRaw`UPDATE ONLY public.audit_logs SET details = NULL`',
      "await tx.tenant.update({ where: { id }, data: { auditLogs: { create: [{ action: 'x' }], deleteMany: {} } } })",
      'await tx.$executeRaw`INSERT INTO audit_logs (id, action) VALUES (${id}, ${a}) ON CONFLICT (id) DO UPDATE SET details = NULL`',
      // 3차 확인(10/24)이 찾은 회귀 — 단축 속성, 따옴표 키, MERGE
      'await tx.tenant.update({ where: { id }, data: { auditLogs: { deleteMany } } })',
      'await tx.tenant.update({ where: { id }, data: { auditLogs: { "deleteMany": {} } } })',
      'await tx.$executeRawUnsafe(`MERGE INTO audit_logs a USING (SELECT 1) s ON true WHEN MATCHED THEN DELETE`)',
    ];
    for (const code of bad) expect(writesIn(code, fields).length, code).toBeGreaterThan(0);
    const ok = [
      'await tx.auditLog.create({ data })',
      'await this.prisma.auditLog.findMany({})',
      'await tx.auditLog?.findFirst({ where: { id } })',
      "type AuditDb = Pick<Prisma.TransactionClient, 'auditLog'>;",
      "await this.auditLog(tx, tenantId, userId, 'variable.create', 'Variable', id, {})",
      'private async auditLog(tx: Prisma.TransactionClient) {}',
      "await tx.$executeRaw`INSERT INTO audit_logs (id, action) VALUES (${id}, ${a})`",
      'include: { corrects: { select: link }, correctedBy: { where: { tenantId }, select: link } }',
      '_count: { select: { correctedBy: { where: { tenantId } } } }',
      'include: { auditLogs: { take: 5, skip: offset, orderBy: { createdAt: \'desc\' } } }',
      'include: { corrects: { where: set } }',
      '// auditLog.update 는 쓰지 않는다',
    ];
    for (const code of ok) expect(writesIn(stripComments(code), fields), code).toEqual([]);
  });
});
