import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CountriesService } from '../countries/countries.service';
import { NotificationEventType } from '../notifications/notification-event';
import { PricingService } from '../pricing/pricing.service';
import { WorkerPresenceService } from '../workers/worker-presence.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { BOOKING_NOTIFIER, BookingNotifier } from './notifications/booking-notifier.interface';
import { Booking, BookingDocument } from './schemas/booking.schema';
import {
  BookingOffer,
  BookingOfferDocument,
  BookingOfferOutcome,
} from './schemas/booking-offer.schema';

// A worker actively doing one of these jobs is unavailable for a NEW
// instant job right now — PENDING_WORKER (a SCHEDULED request she hasn't
// responded to yet) deliberately does NOT count: she hasn't committed to it.
const BUSY_STATUSES = ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'];

@Injectable()
export class InstantMatchingService {
  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(BookingOffer.name) private readonly offerModel: Model<BookingOfferDocument>,
    private readonly workerPresenceService: WorkerPresenceService,
    private readonly workerServicesService: WorkerServicesService,
    private readonly pricingService: PricingService,
    private readonly countriesService: CountriesService,
    private readonly workerProfilesService: WorkerProfilesService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  /** Called by BookingsService.createInstant right after persisting a new SEARCHING booking — kicks off wave 0. */
  async startSearch(booking: BookingDocument): Promise<void> {
    const now = new Date();
    booking.instantMatching = {
      searchStartedAt: now,
      currentWaveIndex: 0,
      currentWaveStartedAt: now,
    };
    await booking.save();
    await this.broadcastWave(booking, 0);
  }

  /**
   * Broadcasts (or re-broadcasts) one wave at `waveIndex`'s radius.
   * Deduplicates against every offer already on record for this booking —
   * a worker who saw an earlier wave is never re-notified, but a
   * re-broadcast at the SAME radius (once the steps are exhausted) still
   * picks up anyone newly eligible since the last tick (e.g. just went
   * online). Public so InstantMatchingSweepService can call it directly
   * for wave expansion.
   */
  async broadcastWave(booking: BookingDocument, waveIndex: number): Promise<void> {
    const country = await this.countriesService.findActiveById(booking.countryId.toString());
    const policy = country.instantMatchingPolicy;
    const radiusMeters = policy.radiusStepsMeters[waveIndex];

    const alreadyNotified = await this.offerModel
      .distinct('workerProfileId', { bookingId: booking._id })
      .exec();

    const candidates = await this.workerPresenceService.findEligibleCandidates({
      serviceId: booking.serviceId.toString(),
      cityId: booking.cityId.toString(),
      point: booking.address.point,
      radiusMeters,
      staleAfterSeconds: policy.heartbeatStalenessSeconds,
      excludeWorkerProfileIds: alreadyNotified.map((id: Types.ObjectId) => id.toString()),
    });
    if (candidates.length === 0) {
      return;
    }

    const busyWorkerIds = new Set(
      (
        await this.bookingModel
          .distinct('workerProfileId', {
            workerProfileId: { $in: candidates.map((c) => c.workerProfileId) },
            status: { $in: BUSY_STATUSES },
          })
          .exec()
      ).map((id: Types.ObjectId) => id.toString()),
    );

    for (const candidate of candidates) {
      if (busyWorkerIds.has(candidate.workerProfileId)) {
        continue;
      }

      const workerService = await this.workerServicesService.findActiveByWorkerAndService(
        candidate.workerProfileId,
        booking.serviceId.toString(),
      );
      const quote = await this.pricingService.quote(workerService.id as string, {
        estimatedHours: booking.pendingQuoteParams?.estimatedHours ?? undefined,
        roomCount: booking.pendingQuoteParams?.roomCount ?? undefined,
      });

      try {
        await this.offerModel.create({
          bookingId: booking._id,
          workerProfileId: candidate.workerProfileId,
          workerServiceId: workerService.id,
          wave: waveIndex,
          radiusMeters,
          distanceMeters: candidate.distanceMeters,
          estimatedPrice: quote.basePrice,
          estimatedWorkerEarnings: quote.workerEarnings,
          currency: quote.currency,
          sentAt: new Date(),
          outcome: BookingOfferOutcome.PENDING,
        });
      } catch (error) {
        // Unique-index race: another sweep tick already offered her this
        // booking between the distinct() above and this insert. Skip, don't fail the wave.
        if ((error as { code?: number }).code === 11000) {
          continue;
        }
        throw error;
      }

      await this.notifier.notifyOffer({
        workerProfileId: candidate.workerProfileId,
        bookingId: booking.id as string,
        wave: waveIndex,
        radiusMeters,
      });
    }
  }

  /**
   * Customer cancelled while SEARCHING, or the booking was swept to
   * NO_WORKER_FOUND — nothing outstanding should still look actionable to a
   * worker. `bookingId` is cast explicitly: unlike `_id` filters (which
   * Mongo/Mongoose always cast regardless of schema recognition),
   * `BookingOffer.bookingId` is an ordinary field, and every offer's
   * bookingId was written from `booking._id` (already an ObjectId) — a
   * plain string filter here would silently match nothing.
   */
  async markOutstandingOffersStale(bookingId: string): Promise<void> {
    await this.offerModel
      .updateMany(
        { bookingId: new Types.ObjectId(bookingId), outcome: BookingOfferOutcome.PENDING },
        { outcome: BookingOfferOutcome.STALE, respondedAt: new Date() },
      )
      .exec();
  }

  /** Called once BookingsService.acceptOffer has atomically decided the winner. Never affects any worker's stats — see BookingOfferOutcome's doc comment. */
  async resolveOffers(bookingId: string, winningWorkerProfileId: string): Promise<void> {
    const bookingObjectId = new Types.ObjectId(bookingId);
    await this.offerModel
      .updateOne(
        { bookingId: bookingObjectId, workerProfileId: winningWorkerProfileId },
        { outcome: BookingOfferOutcome.WON, respondedAt: new Date() },
      )
      .exec();

    const losingFilter = {
      bookingId: bookingObjectId,
      workerProfileId: { $ne: winningWorkerProfileId },
      outcome: BookingOfferOutcome.PENDING,
    };
    // Read who's about to lose BEFORE the update — notification is best-effort
    // and must never block or fail the actual state change above it.
    const losingOffers = await this.offerModel.distinct('workerProfileId', losingFilter).exec();
    await this.offerModel
      .updateMany(losingFilter, { outcome: BookingOfferOutcome.LOST, respondedAt: new Date() })
      .exec();

    for (const workerProfileId of losingOffers) {
      try {
        const profile = await this.workerProfilesService.getForAdmin(workerProfileId.toString());
        await this.notifier.notify({
          type: NotificationEventType.OFFER_TAKEN,
          recipientUserId: profile.userId.toString(),
          bookingId,
          context: {},
        });
      } catch {
        // A worker whose offer just lost no longer having a resolvable
        // profile is not worth failing acceptance over — same best-effort
        // spirit as every other notify() call site.
      }
    }
  }
}
