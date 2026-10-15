import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Booking, BookingDocument } from './schemas/booking.schema';

const SWEEP_JOB_NAME = 'booking-expiry-sweep';

/**
 * Periodically EXPIREs any PENDING_WORKER booking past its responseDeadline.
 * The interval itself is registered through SchedulerRegistry (not the
 * static @Interval() decorator) specifically so it can be read from config
 * and skipped entirely — BOOKING_EXPIRY_SWEEP_ENABLED/BOOKING_EXPIRY_SWEEP_INTERVAL_SECONDS.
 */
@Injectable()
export class BookingExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('booking.expirySweepEnabled', true);
    if (!enabled) {
      this.logger.log('Booking expiry sweep disabled (BOOKING_EXPIRY_SWEEP_ENABLED=false)');
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'booking.expirySweepIntervalSeconds',
      300,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Booking expiry sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Booking expiry sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  /**
   * Claim-then-update, not read-then-write: `find()` only discovers
   * candidates — the actual state change happens one document at a time via
   * `updateOne({ _id, status: PENDING_WORKER }, { status: EXPIRED })`, with
   * the status re-checked in that same atomic update filter. If a second
   * instance (or an overlapping sweep tick) races to the same booking, at
   * most one updateOne call actually matches and modifies it; the loser's
   * call matches zero documents instead of double-expiring or throwing.
   * Safe to call concurrently or back-to-back.
   */
  async sweep(): Promise<number> {
    const overdue = await this.bookingModel
      .find({ status: BookingStatus.PENDING_WORKER, responseDeadline: { $lte: new Date() } })
      .select('_id')
      .exec();

    let expiredCount = 0;
    for (const { _id } of overdue) {
      const result = await this.bookingModel
        .updateOne({ _id, status: BookingStatus.PENDING_WORKER }, { status: BookingStatus.EXPIRED })
        .exec();
      if (result.modifiedCount > 0) {
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.log(`Booking expiry sweep: expired ${expiredCount} booking(s)`);
    }
    return expiredCount;
  }
}
