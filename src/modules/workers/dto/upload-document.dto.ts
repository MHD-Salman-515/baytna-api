import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { DocumentType } from '../schemas/worker-document.schema';

/** Accompanies the multipart file as regular form fields. */
export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiPropertyOptional({ description: 'Required for CRIMINAL_RECORD; ISO date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
