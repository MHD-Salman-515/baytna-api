import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { CountriesService } from '../countries/countries.service';
import { InstantMatchingService } from './instant-matching.service';
import { Booking, BookingDocument } from './schemas/booking.schema';

const SWEEP_JOB_NAME = 'instant-matching-sweep';

/**
 * Drives everything time-based about an INSTANT search: expanding to the
 * next wave once the current one times out, and moving to NO_WORKER_FOUND
 * once the total request timeout elapses. Same approach as
 * BookingExpiryService (Phase 5): a periodic sweep via SchedulerRegistry,
 * not in-process setTimeout (which dies with the process and wouldn't
 * survive a restart or coordinate across multiple instances), and every
 * state change is claim-then-update — the filter re-checks the exact value
 * being changed, so two sweep ticks (same instance or different instances)
 * racing the same booking can't both apply.
 */
@Injectable()
export class InstantMatchingSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstantMatchingSweepService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly instantMatchingService: InstantMatchingService,
    private readonly countriesService: CountriesService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('booking.instantMatchingSweepEnabled', true);
    if (!enabled) {
      this.logger.log('Instant matching sweep disabled (BOOKING_INSTANT_SWEEP_ENABLED=false)');
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'booking.instantMatchingSweepIntervalSeconds',
      5,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Instant matching sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Instant matching sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  async sweep(): Promise<{ expanded: number; noWorkerFound: number }> {
    const searching = await this.bookingModel.find({ status: BookingStatus.SEARCHING }).exec();
    let expanded = 0;
    let noWorkerFound = 0;

    for (const booking of searching) {
      const matching = booking.instantMatching;
      if (!matching) continue; // defensive — every SEARCHING booking has one, set at creation

      const country = await this.countriesService.findActiveById(booking.countryId.toString());
      const policy = country.instantMatchingPolicy;
      const now = Date.now();

      if (now - matching.searchStartedAt.getTime() >= policy.totalRequestTimeoutSeconds * 1000) {
        const claimed = await this.bookingModel
          .findOneAndUpdate(
            { _id: booking._id, status: BookingStatus.SEARCHING },
            { status: BookingStatus.NO_WORKER_FOUND },
            { new: true },
          )
          .exec();
        if (claimed) {
          await this.instantMatchingService.markOutstandingOffersStale(booking.id as string);
          noWorkerFound++;
        }
        continue;
      }

      if (now - matching.currentWaveStartedAt.getTime() >= policy.waveTimeoutSeconds * 1000) {
        const nextWaveIndex = Math.min(
          matching.currentWaveIndex + 1,
          policy.radiusStepsMeters.length - 1,
        );
        // Claim guard: the filter re-checks currentWaveIndex at its OLD
        // value, so only one racing sweep tick actually bumps it (and
        // therefore actually re-broadcasts) — the other matches zero documents.
        const claimed = await this.bookingModel
          .findOneAndUpdate(
            {
              _id: booking._id,
              status: BookingStatus.SEARCHING,
              'instantMatching.currentWaveIndex': matching.currentWaveIndex,
            },
            {
              $set: {
                'instantMatching.currentWaveIndex': nextWaveIndex,
                'instantMatching.currentWaveStartedAt': new Date(),
              },
            },
            { new: true },
          )
          .exec();
        if (claimed) {
          await this.instantMatchingService.broadcastWave(claimed, nextWaveIndex);
          expanded++;
        }
      }
    }

    if (expanded > 0 || noWorkerFound > 0) {
      this.logger.log(
        `Instant matching sweep: expanded ${expanded} wave(s), ${noWorkerFound} NO_WORKER_FOUND`,
      );
    }
    return { expanded, noWorkerFound };
  }
}
