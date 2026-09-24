import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { LocalizedNameDto } from '../../../common/dto/localized-name.dto';
import { GeoPointDto } from './geo-point.dto';

export class CreateCityDto {
  @ApiProperty({ description: 'Country ObjectId this city belongs to' })
  @IsMongoId()
  countryId!: string;

  @ApiProperty({ type: LocalizedNameDto })
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name!: LocalizedNameDto;

  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  center!: GeoPointDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
