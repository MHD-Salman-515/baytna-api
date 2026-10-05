import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LocalizedTextDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  en?: string;
}
