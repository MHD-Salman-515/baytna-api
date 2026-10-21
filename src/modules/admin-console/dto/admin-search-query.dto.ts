import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class AdminSearchQueryDto {
  @ApiPropertyOptional({ description: 'Matches a substring of the phone number' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  phone?: string;

  @ApiPropertyOptional({ description: "Matches a substring of the user's first or last name" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ description: 'Matches a prefix of a booking number, e.g. "BK-A1B2"' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  bookingNumber?: string;
}
