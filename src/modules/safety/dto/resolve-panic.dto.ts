import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResolvePanicDto {
  @ApiProperty({ example: 'Called the worker — she confirmed she is safe, false alarm' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolutionNote!: string;
}
