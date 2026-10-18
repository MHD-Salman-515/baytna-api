import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  BookingLocationTrail,
  BookingLocationTrailDocument,
} from './schemas/booking-location-trail.schema';

const SWEEP_JOB_NAME = 'location-trail-purge-sweep';

/**
 * Deletes trails a short, configurable retention after they were marked
 * terminated (see LocationTrackingService.markTerminated) — long enough for
 * a no-show/dispute to still be investigated, never indefinitely. Same
 * SchedulerRegistry pattern as every other sweep in this module.
 */
@Injectable()
export class LocationTrailPurgeSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocationTrailPurgeSweepService.name);

  constructor(
    @InjectModel(BookingLocationTrail.name)
    private readonly trailModel: Model<BookingLocationTrailDocument>,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('location.trailPurgeSweepEnabled', true);
    if (!enabled) {
      this.logger.log(
        'Location trail purge sweep disabled (LOCATION_TRAIL_PURGE_SWEEP_ENABLED=false)',
      );
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'location.trailPurgeSweepIntervalSeconds',
      300,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Location trail purge sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Location trail purge sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  async sweep(): Promise<number> {
    const retentionHours = this.configService.get<number>('location.trailRetentionHours', 24);
    const cutoff = new Date(Date.now() - retentionHours * 3_600_000);

    const result = await this.trailModel
      .deleteMany({ terminatedAt: { $ne: null, $lte: cutoff } })
      .exec();

    if (result.deletedCount > 0) {
      this.logger.log(`Location trail purge sweep: deleted ${result.deletedCount} trail(s)`);
    }
    return result.deletedCount;
  }
}
