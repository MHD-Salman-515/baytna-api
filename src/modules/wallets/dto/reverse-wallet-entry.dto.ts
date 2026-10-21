import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class ReverseWalletEntryDto {
  @ApiProperty({ description: 'The _id of the WalletEntry being corrected' })
  @IsMongoId()
  entryId!: string;

  @ApiProperty({ example: 'Commission was charged against the wrong booking' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
