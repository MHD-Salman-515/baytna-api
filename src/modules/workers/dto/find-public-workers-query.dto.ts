import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindPublicWorkersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only workers willing to work in this city' })
  @IsOptional()
  @IsMongoId()
  cityId?: string;

  @ApiPropertyOptional({
    description:
      'Reserved for Phase 4 (service catalog) — accepted but currently has no effect, since no worker-to-service relation exists yet.',
  })
  @IsOptional()
  serviceId?: string;
}
