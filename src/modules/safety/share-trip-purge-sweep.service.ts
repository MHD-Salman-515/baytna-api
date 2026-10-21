import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingsService } from '../bookings/bookings.service';
import { SHARE_TRIP_TERMINAL_STATUSES } from './share-trip.service';
import { ShareTripToken, ShareTripTokenDocument } from './schemas/share-trip-token.schema';

const SWEEP_JOB_NAME = 'share-trip-purge-sweep';

/**
 * Hygiene, not the enforcement mechanism — ShareTripService.getPublicView
 * already refuses a token past its grace period on every read. This just
 * soft-deletes rows that are unambiguously, permanently done, same
 * SchedulerRegistry pattern as every other sweep in this app. A booking
 * that's gone entirely (shouldn't happen, but see the catch) is purged too.
 */
@Injectable()
export class ShareTripPurgeSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShareTripPurgeSweepService.name);

  constructor(
    @InjectModel(ShareTripToken.name) private readonly tokenModel: Model<ShareTripTokenDocument>,
    private readonly bookingsService: BookingsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('safety.shareTripTokenPurgeSweepEnabled', true);
    if (!enabled) {
      this.logger.log('Share-trip purge sweep disabled (SHARE_TRIP_PURGE_SWEEP_ENABLED=false)');
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'safety.shareTripTokenPurgeSweepIntervalSeconds',
      300,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Share-trip purge sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Share-trip purge sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  async sweep(): Promise<number> {
    const gracePeriodMs =
      this.configService.get<number>('safety.shareTripGracePeriodMinutes', 60) * 60_000;
    const candidates = await this.tokenModel.find({ isDeleted: false }).exec();

    let purgedCount = 0;
    for (const token of candidates) {
      let shouldPurge = false;
      try {
        const booking = await this.bookingsService.getForAdmin(token.bookingId.toString());
        const terminalAt = booking.completedAt ?? booking.cancelledAt ?? booking.updatedAt ?? null;
        shouldPurge =
          SHARE_TRIP_TERMINAL_STATUSES.includes(booking.status) &&
          terminalAt !== null &&
          Date.now() > terminalAt.getTime() + gracePeriodMs;
      } catch {
        shouldPurge = true; // the booking itself is gone — nothing left to share
      }

      if (shouldPurge) {
        token.isDeleted = true;
        token.deletedAt = new Date();
        await token.save();
        purgedCount++;
      }
    }

    if (purgedCount > 0) {
      this.logger.log(`Share-trip purge sweep: purged ${purgedCount} token(s)`);
    }
    return purgedCount;
  }
}
