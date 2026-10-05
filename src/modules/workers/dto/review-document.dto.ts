import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, ValidateNested } from 'class-validator';
import { LocalizedTextDto } from './localized-text.dto';

export const DOCUMENT_REVIEW_ACTIONS = ['approve', 'reject'] as const;
export type DocumentReviewAction = (typeof DOCUMENT_REVIEW_ACTIONS)[number];

export class ReviewDocumentDto {
  @ApiProperty({ enum: DOCUMENT_REVIEW_ACTIONS })
  @IsIn(DOCUMENT_REVIEW_ACTIONS)
  action!: DocumentReviewAction;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Required when action is "reject"' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  reason?: LocalizedTextDto;
}
