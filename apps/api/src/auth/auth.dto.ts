import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'admin@demo.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'demo', required: false })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  tenantSlug?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class RegisterDto {
  @ApiProperty()
  @IsString()
  tenantName: string;

  @ApiProperty()
  @IsString()
  tenantSlug: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty()
  @IsString()
  name: string;
}