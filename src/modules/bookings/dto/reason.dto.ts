import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Shared shape for every endpoint that requires a reason: reject, cancel (both sides). */
export class ReasonDto {
  @ApiProperty({ example: 'Too far from my service area' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
