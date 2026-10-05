import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum PublicWorkersSortBy {
  RATING = 'rating',
  PRICE = 'price',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class FindPublicWorkersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only workers willing to work in this city' })
  @IsOptional()
  @IsMongoId()
  cityId?: string;

  @ApiPropertyOptional({ description: 'Only workers who actively offer this service' })
  @IsOptional()
  @IsMongoId()
  serviceId?: string;

  @ApiPropertyOptional({
    enum: PublicWorkersSortBy,
    default: PublicWorkersSortBy.RATING,
    description:
      '"price" only has an effect together with serviceId — it is the price of THAT service.',
  })
  @IsOptional()
  @IsEnum(PublicWorkersSortBy)
  sortBy?: PublicWorkersSortBy;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}
