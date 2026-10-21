import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AssignReportDto {
  @ApiProperty({ description: 'The admin User id to assign this report to' })
  @IsMongoId()
  assignedTo!: string;
}
