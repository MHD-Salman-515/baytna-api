import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingType } from '../../common/enums/booking-type.enum';
import { NotificationEventType } from '../notifications/notification-event';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { BOOKING_NOTIFIER, BookingNotifier } from './notifications/booking-notifier.interface';
import { Booking, BookingDocument } from './schemas/booking.schema';

const SWEEP_JOB_NAME = 'scheduled-reminder-sweep';

/**
 * Sends a worker-facing SCHEDULED_REMINDER once a confirmed SCHEDULED
 * booking is within `reminderLeadMinutes` of scheduledFor — only once a
 * worker has actually committed (ACCEPTED), never while still
 * PENDING_WORKER (that's BookingExpiryService's concern). Same
 * claim-then-update discipline as BookingExpiryService/
 * InstantMatchingSweepService: `find()` only discovers candidates,
 * `reminderSentAt` is set via an atomic updateOne re-checking it's still
 * null, so a racing/overlapping sweep tick can't double-send.
 */
@Injectable()
export class ScheduledReminderSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledReminderSweepService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('booking.reminderSweepEnabled', true);
    if (!enabled) {
      this.logger.log('Scheduled reminder sweep disabled (SCHEDULED_REMINDER_SWEEP_ENABLED=false)');
      return;
    }

    const intervalSeconds = this.configService.get<number>(
      'booking.reminderSweepIntervalSeconds',
      300,
    );
    const interval = setInterval(() => {
      this.sweep().catch((error: Error) =>
        this.logger.error('Scheduled reminder sweep failed', error.stack),
      );
    }, intervalSeconds * 1000);
    this.schedulerRegistry.addInterval(SWEEP_JOB_NAME, interval);
    this.logger.log(`Scheduled reminder sweep running every ${intervalSeconds}s`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', SWEEP_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(SWEEP_JOB_NAME);
    }
  }

  async sweep(): Promise<number> {
    const leadMinutes = this.configService.get<number>('booking.reminderLeadMinutes', 60);
    const dueBy = new Date(Date.now() + leadMinutes * 60_000);

    const due = await this.bookingModel
      .find({
        type: BookingType.SCHEDULED,
        status: BookingStatus.ACCEPTED,
        scheduledFor: { $lte: dueBy },
        reminderSentAt: null,
      })
      .select('_id workerProfileId')
      .exec();

    let sentCount = 0;
    for (const booking of due) {
      const claimed = await this.bookingModel
        .updateOne({ _id: booking._id, reminderSentAt: null }, { reminderSentAt: new Date() })
        .exec();
      if (claimed.modifiedCount === 0) {
        continue; // another tick already claimed it
      }

      try {
        const profile = await this.workerProfilesService.getForAdmin(
          booking.workerProfileId!.toString(),
        );
        await this.notifier.notify({
          type: NotificationEventType.SCHEDULED_REMINDER,
          recipientUserId: profile.userId.toString(),
          bookingId: booking.id as string,
          context: { scheduledForIso: booking.scheduledFor!.toISOString() },
        });
        sentCount++;
      } catch (error) {
        this.logger.error(
          `Failed to notify reminder for booking ${booking.id as string}`,
          (error as Error).stack,
        );
      }
    }

    if (sentCount > 0) {
      this.logger.log(`Scheduled reminder sweep: sent ${sentCount} reminder(s)`);
    }
    return sentCount;
  }
}
