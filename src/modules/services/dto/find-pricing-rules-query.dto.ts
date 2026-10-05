import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class FindPricingRulesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  countryId?: string;
}
