import { Injectable, Logger } from '@nestjs/common';
import { BookingNotifier, BookingOfferNotification } from './booking-notifier.interface';

/** DEV-ONLY stand-in for push/websockets — see BookingNotifier's own doc comment. */
@Injectable()
export class LogNotifier implements BookingNotifier {
  private readonly logger = new Logger(LogNotifier.name);

  async notifyOffer(notification: BookingOfferNotification): Promise<void> {
    this.logger.log(
      `[LogNotifier (DEV ONLY)] Offer sent to worker ${notification.workerProfileId} for booking ` +
        `${notification.bookingId} (wave ${notification.wave}, radius ${notification.radiusMeters}m) — ` +
        'would push a real notification here in production',
    );
  }
}
