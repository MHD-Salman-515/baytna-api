import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, ValidateNested } from 'class-validator';
import { LocalizedTextDto } from './localized-text.dto';

export const WORKER_REVIEW_ACTIONS = ['approve', 'reject', 'suspend'] as const;
export type WorkerReviewAction = (typeof WORKER_REVIEW_ACTIONS)[number];

export class ReviewWorkerDto {
  @ApiProperty({ enum: WORKER_REVIEW_ACTIONS })
  @IsIn(WORKER_REVIEW_ACTIONS)
  action!: WorkerReviewAction;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Required when action is "reject"' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  reason?: LocalizedTextDto;
}
