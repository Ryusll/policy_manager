import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ArrayUnique,
} from 'class-validator';

export class PolicyRevisionNotifyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  userIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  groupIds?: string[];
}

export class CreateNotificationGroupDto {
  @ApiProperty({ example: '정보보안팀' })
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}

export class UpdateNotificationGroupDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}
