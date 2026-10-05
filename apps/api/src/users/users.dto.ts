import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  // 로그인·구글 연결이 모두 소문자 이메일로 사용자를 찾는다. 여기서 낮추지 않으면
  // 관리자가 대문자를 섞어 만든 계정은 로그인도, 구글 연결도 되지 않는다(T-42).
  @ApiProperty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: ['admin', 'editor', 'viewer'] })
  @IsEnum(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** 내 정보 수정 — 이름만. 이메일·역할은 관리자 경로(`PATCH /users/:id`)에서만 바꾼다 */
export class UpdateMyProfileDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

/**
 * 관리자의 사용자 정보 수정. 보낸 항목만 바꾼다.
 *
 * `@IsOptional` 대신 `@ValidateIf(!== undefined)` 를 쓴 이유: `@IsOptional` 은 `null` 도
 * "없음"으로 통과시켜, 필수 컬럼인 이름·이메일·역할에 `null` 이 그대로 흘러간다.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((o: UpdateUserDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  // 로그인·구글 연결이 소문자 이메일로 사용자를 찾는다(CreateUserDto 와 같은 이유)
  @ApiPropertyOptional()
  @ValidateIf((o: UpdateUserDto) => o.email !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: ['admin', 'editor', 'viewer'] })
  @ValidateIf((o: UpdateUserDto) => o.role !== undefined)
  @IsEnum(['admin', 'editor', 'viewer'])
  role?: 'admin' | 'editor' | 'viewer';
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  // 길이·바이트 한도·"현재와 같음"은 passwordProblem 이 문구까지 만들어 준다
  @ApiProperty({ minLength: 8 })
  @IsString()
  newPassword: string;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  newPassword: string;
}
