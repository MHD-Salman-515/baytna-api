import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocalizedNameDto } from '../../../common/dto/localized-name.dto';

export class CreateCountryDto {
  @ApiProperty({ example: 'SY', description: 'ISO alpha-2 country code' })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'code must be a 2-letter uppercase ISO alpha-2 code' })
  code!: string;

  @ApiProperty({ type: LocalizedNameDto })
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name!: LocalizedNameDto;

  @ApiProperty({ example: 'SYP' })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter uppercase code' })
  currencyCode!: string;

  @ApiProperty({ example: '+963' })
  @IsString()
  @Matches(/^\+\d{1,4}$/, { message: 'phonePrefix must look like +963' })
  phonePrefix!: string;

  @ApiPropertyOptional({ type: [String], example: ['CASH'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledPaymentMethods?: string[];

  @ApiProperty({ example: 1500, description: 'Basis points, e.g. 1500 = 15%' })
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionRate!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
