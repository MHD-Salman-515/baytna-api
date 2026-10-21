import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportCategory, ReportSubjectType } from '../schemas/report.schema';

export class CreateReportDto {
  @ApiProperty({ enum: ReportSubjectType })
  @IsEnum(ReportSubjectType)
  subjectType!: ReportSubjectType;

  @ApiProperty({ description: 'A User id, a WorkerProfile id, or a Booking id, per subjectType' })
  @IsMongoId()
  subjectId!: string;

  @ApiPropertyOptional({ description: 'Set when the report concerns a specific booking' })
  @IsOptional()
  @IsMongoId()
  bookingId?: string;

  @ApiProperty({ enum: ReportCategory })
  @IsEnum(ReportCategory)
  category!: ReportCategory;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;
}
