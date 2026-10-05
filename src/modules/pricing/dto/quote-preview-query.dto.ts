import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

export class QuotePreviewQueryDto {
  @ApiProperty()
  @IsMongoId()
  workerServiceId!: string;

  @ApiPropertyOptional({
    description: "HOURLY only — defaults to the worker's minHours if omitted or below it",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  estimatedHours?: number;

  @ApiPropertyOptional({ description: 'BY_SIZE only — required for that pricing type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomCount?: number;
}
