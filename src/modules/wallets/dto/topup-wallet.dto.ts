import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class TopupWalletDto {
  @ApiProperty({ example: 10000, description: 'Positive integer — credited to the wallet' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({
    example: 'RCPT-2026-00142',
    description: 'Receipt number or agent id — required for real-world traceability',
  })
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @ApiPropertyOptional({ example: 'Paid in cash at the Damascus office' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description:
      'Optional — defaults to a key derived from workerProfileId + reference, so resubmitting the same reference for the same wallet is itself deduplicated',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
