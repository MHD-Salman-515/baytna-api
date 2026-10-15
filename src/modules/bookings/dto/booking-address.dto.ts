import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { GeoPointDto } from '../../cities/dto/geo-point.dto';

/**
 * Addresses in our markets are informal — a map pin plus a free-text
 * landmark is the real identifier, so both are required and the landmark
 * must not be empty.
 */
export class BookingAddressDto {
  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  point!: GeoPointDto;

  @ApiProperty({ example: 'Al-Mazzeh, Street 12, Building 4' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiProperty({ example: 'Next to the blue mosque' })
  @IsString()
  @IsNotEmpty()
  landmark!: string;

  @ApiPropertyOptional({ example: '3rd floor' })
  @IsOptional()
  @IsString()
  floor?: string;

  @ApiPropertyOptional({ example: 'Ring the bell twice' })
  @IsOptional()
  @IsString()
  notes?: string;
}
