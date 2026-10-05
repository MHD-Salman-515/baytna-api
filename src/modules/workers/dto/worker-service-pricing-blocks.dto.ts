import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

export class HourlyPricingDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  rate!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  minHours!: number;
}

export class SizeTierDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  maxRooms!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  price!: number;
}

export class BySizePricingDto {
  @ApiProperty({ type: [SizeTierDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SizeTierDto)
  tiers!: SizeTierDto[];
}

export class FixedPricingDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  price!: number;
}
