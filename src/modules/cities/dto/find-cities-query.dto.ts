import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindCitiesQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Country ObjectId to filter cities by' })
  @IsMongoId()
  countryId!: string;
}
