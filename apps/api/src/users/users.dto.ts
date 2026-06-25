import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
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

  @ApiProperty({ enum: ['admin', 'editor', 'viewer'] })
  @IsEnum(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}
