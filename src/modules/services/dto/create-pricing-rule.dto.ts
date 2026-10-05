import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsMongoId, IsOptional, IsString, Min } from 'class-validator';
import { PricingType } from '../../../common/enums/pricing-type.enum';

export class CreatePricingRuleDto {
  @ApiProperty()
  @IsMongoId()
  serviceId!: string;

  @ApiProperty()
  @IsMongoId()
  countryId!: string;

  @ApiProperty({ enum: PricingType })
  @IsEnum(PricingType)
  pricingType!: PricingType;

  @ApiProperty({ description: 'Integer, in the country currency' })
  @IsInt()
  @Min(0)
  minPrice!: number;

  @ApiProperty({ description: 'Integer, in the country currency' })
  @IsInt()
  @Min(0)
  maxPrice!: number;

  @ApiPropertyOptional({
    example: 'hour',
    description: 'Presentational only — "hour", "room", "job", etc.',
  })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
