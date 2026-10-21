import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAdminReviewsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isHidden?: boolean;

  @ApiPropertyOptional({ description: 'A WorkerProfile id or a customer User id' })
  @IsOptional()
  @IsMongoId()
  subjectId?: string;
}
