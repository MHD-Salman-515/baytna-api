import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { BookingStatus } from '../../../common/enums/booking-status.enum';

const FORCEABLE_STATUSES = [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] as const;

export class ForceBookingStatusDto {
  @ApiProperty({ enum: FORCEABLE_STATUSES })
  @IsIn(FORCEABLE_STATUSES)
  status!: BookingStatus.CANCELLED | BookingStatus.NO_SHOW;

  @ApiProperty({ example: 'Customer reported worker never arrived; confirmed by both parties' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
