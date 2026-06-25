import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariableDto {
  @ApiProperty({ example: 'COMPANY_NAME' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key: string;

  @ApiProperty({ example: '회사명' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultValue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateVariableDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultValue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
