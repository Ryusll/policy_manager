import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateArticleCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

export class UpdateArticleCommentDto {
  @IsOptional()
  @IsBoolean()
  isResolved?: boolean;
}

