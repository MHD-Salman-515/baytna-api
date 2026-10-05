import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocalizedNameDto } from '../../../common/dto/localized-name.dto';
import { LocalizedTextDto } from '../../../common/dto/localized-text.dto';
import { PricingType } from '../../../common/enums/pricing-type.enum';

export class CreateServiceDto {
  @ApiProperty({ example: 'CLEANING' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'key must be an uppercase machine identifier, e.g. CLEANING',
  })
  key!: string;

  @ApiProperty({ type: LocalizedNameDto })
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name!: LocalizedNameDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ enum: PricingType, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(PricingType, { each: true })
  allowedPricingTypes!: PricingType[];

  @ApiPropertyOptional({
    description: 'Basis points. Omit to fall back to the country commissionRate at quote time.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionRate?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
