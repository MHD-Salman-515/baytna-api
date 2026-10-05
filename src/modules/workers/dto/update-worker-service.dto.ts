import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { PricingType } from '../../../common/enums/pricing-type.enum';
import {
  BySizePricingDto,
  FixedPricingDto,
  HourlyPricingDto,
} from './worker-service-pricing-blocks.dto';

// Deliberately NOT a PartialType(CreateWorkerServiceDto) — there is no
// `currency` field here at all. Currency is set once at creation (derived
// from her country) and is never editable afterwards, full stop.
export class UpdateWorkerServiceDto {
  @ApiPropertyOptional({ enum: PricingType })
  @IsOptional()
  @IsEnum(PricingType)
  pricingType?: PricingType;

  @ApiPropertyOptional({ type: HourlyPricingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HourlyPricingDto)
  hourly?: HourlyPricingDto;

  @ApiPropertyOptional({ type: BySizePricingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BySizePricingDto)
  bySize?: BySizePricingDto;

  @ApiPropertyOptional({ type: FixedPricingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FixedPricingDto)
  fixed?: FixedPricingDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
