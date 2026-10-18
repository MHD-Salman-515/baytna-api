import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateLocaleDto {
  @ApiProperty({ enum: ['ar', 'en'] })
  @IsIn(['ar', 'en'])
  locale!: 'ar' | 'en';
}
