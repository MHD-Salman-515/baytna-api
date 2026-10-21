import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class AdjustWalletDto {
  @ApiProperty({
    example: -500,
    description: 'Signed integer — positive credits the wallet, negative debits it',
  })
  @IsInt()
  amount!: number;

  @ApiProperty({ example: 'Correcting a duplicate manual charge from before this ledger existed' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
