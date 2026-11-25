/**
 * 고객사 개설 — 서버에서 쓰는 진입점 (T-122).
 *
 * 공개 회원가입이 닫힌 뒤로는 **새 서버의 첫 플랫폼 관리자**를 화면에서 만들 방법이 없다(화면의
 * 고객사 개설은 플랫폼 관리자만 쓴다). 그 첫 계정을 여기서 만든다. 화면의 개설과 같은 서비스
 * 메서드를 쓰므로 규칙(조직 코드 형식·임시 비밀번호·첫 로그인 변경)이 갈라지지 않는다.
 *
 * 입력은 stdin 의 JSON 한 줄 — `{ name, slug, plan?, masterEmail, masterName, platformAdmin? }`.
 * 서버에서는 `scripts/oracle/create-tenant.sh` 로 부른다. 임시 비밀번호는 이 출력에만 나온다.
 */
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateTenantDto } from './platform-admin.dto';
import { PlatformAdminService } from './platform-admin.service';

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main(): Promise<number> {
  const input = JSON.parse(await readStdin()) as Record<string, unknown>;
  const dto = plainToInstance(CreateTenantDto, input);
  const errors = await validate(dto, { whitelist: true });
  if (errors.length) {
    console.error(errors.flatMap((e) => Object.values(e.constraints ?? {})).join('\n'));
    return 1;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(PlatformAdminService).createTenant(null, dto);
    if (input.platformAdmin === true) {
      // 아스트룸 운영자 계정 — 모든 고객사를 개설·관리한다
      await app.get(PrismaService).user.update({
        where: { id: result.master.id },
        data: { platformRole: 'global_admin' },
      });
    }
    console.log(`개설 완료: ${result.tenant.name} (조직 코드 ${result.tenant.slug}, ${result.tenant.plan})`);
    console.log(`마스터: ${result.master.email}${input.platformAdmin === true ? ' — 플랫폼 관리자' : ''}`);
    console.log(`임시 비밀번호: ${result.temporaryPassword}`);
    console.log('※ 이 비밀번호는 다시 볼 수 없습니다. 처음 로그인할 때 바꾸게 됩니다.');
    return 0;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`개설 실패: ${e?.message ?? e}`);
    process.exit(1);
  });
