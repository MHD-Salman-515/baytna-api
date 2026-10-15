import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GetSlotsQueryDto {
  @ApiProperty({
    example: '2026-11-10',
    description: "YYYY-MM-DD, in the worker's country timezone",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must look like "YYYY-MM-DD"' })
  date!: string;
}
