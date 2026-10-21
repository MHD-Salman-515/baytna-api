import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { WalletsService } from '../wallets/wallets.service';
import { Booking, BookingDocument } from './schemas/booking.schema';

const SWEEP_JOB_NAME = 'commission-charge-retry-sweep';

/**
 * Catches any COMPLETED booking whose commission was never charged —
 * BookingsService.complete() already tried once and swallowed the failure
 * (so a flaky ledger write never blocks a worker from finishing a job). The
 * charge itself (WalletsService.chargeCommission) is idempotent on
 * `commission:${bookingId}`, so retrying an already-charged booking is
 * always safe, and an overlapping sweep tick can never double-charge.
 */
@Injectable()
export class CommissionChargeRetrySweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionChargeRetrySweepService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly walletsService: WalletsService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>(
      'wallet.commissionChargeRetrySweepEnabled',
      true,
    );
    if (!enabled) {
      this.logger.log(
        'Commission charge retry sweep disabled (COMMISSION_CHARGE_RETRY_SWEEP_ENABLED=false)',
      );
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'wallet.commissionChargeRetrySweepIntervalSeconds',
      300,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Commission charge retry sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Commission charge retry sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  async sweep(): Promise<number> {
    const uncharged = await this.bookingModel
      .find({ status: BookingStatus.COMPLETED, commissionChargedAt: null })
      .exec();

    let chargedCount = 0;
    for (const booking of uncharged) {
      try {
        await this.walletsService.chargeCommission(
          booking.id as string,
          booking.workerProfileId!.toString(),
          booking.finalPricing!.commissionAmount,
          booking.finalPricing!.currency,
        );
        await this.bookingModel
          .updateOne({ _id: booking._id }, { commissionChargedAt: new Date() })
          .exec();
        chargedCount++;
      } catch (error) {
        this.logger.error(
          `Retry failed to charge commission for booking ${booking.id as string}`,
          (error as Error).stack,
        );
        await this.auditLogService.record({
          actorUserId: null,
          action: AuditAction.WALLET_COMMISSION_CHARGE_FAILED,
          targetType: 'Booking',
          targetId: booking.id as string,
          metadata: { error: (error as Error).message, retry: true },
        });
      }
    }

    if (chargedCount > 0) {
      this.logger.log(`Commission charge retry sweep: charged ${chargedCount} booking(s)`);
    }
    return chargedCount;
  }
}
