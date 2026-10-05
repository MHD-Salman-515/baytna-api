import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsMongoId, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PricingType } from '../../../common/enums/pricing-type.enum';
import {
  BySizePricingDto,
  FixedPricingDto,
  HourlyPricingDto,
} from './worker-service-pricing-blocks.dto';

export class CreateWorkerServiceDto {
  @ApiProperty()
  @IsMongoId()
  serviceId!: string;

  @ApiProperty({ enum: PricingType })
  @IsEnum(PricingType)
  pricingType!: PricingType;

  @ApiPropertyOptional({
    type: HourlyPricingDto,
    description: 'Required when pricingType is HOURLY',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => HourlyPricingDto)
  hourly?: HourlyPricingDto;

  @ApiPropertyOptional({
    type: BySizePricingDto,
    description: 'Required when pricingType is BY_SIZE',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BySizePricingDto)
  bySize?: BySizePricingDto;

  @ApiPropertyOptional({ type: FixedPricingDto, description: 'Required when pricingType is FIXED' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FixedPricingDto)
  fixed?: FixedPricingDto;

  @ApiPropertyOptional({
    description:
      'Optional — if given, must match your country currency exactly. Omit to use your country currency automatically.',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}
