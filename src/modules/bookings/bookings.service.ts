import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingType } from '../../common/enums/booking-type.enum';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { CountryBookingPolicy } from '../countries/schemas/country.schema';
import { NotificationEventType } from '../notifications/notification-event';
import { PricingService } from '../pricing/pricing.service';
import { roundHalfUpDivide } from '../pricing/round-half-up-divide';
import { ServicesService } from '../services/services.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WorkerAvailabilityService } from '../workers/worker-availability.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { NearestAvailableAssignmentStrategy } from './assignment/nearest-available-assignment.strategy';
import {
  BookingProjectionInput,
  BookingViewer,
  CustomerRatingSummary,
  toBookingView,
} from './booking-projection';
import { BookingAction, assertValidAction } from './booking.state-machine';
import { computeFinalPricing } from './compute-final-pricing';
import { AdminFindBookingsQueryDto } from './dto/admin-find-bookings-query.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FindBookingsQueryDto } from './dto/find-bookings-query.dto';
import { ForceBookingStatusDto } from './dto/force-booking-status.dto';
import { generateBookingNumber } from './generate-booking-number';
import { InstantMatchingService } from './instant-matching.service';
import { LocationTrackingService } from './location-tracking.service';
import { BOOKING_NOTIFIER, BookingNotifier } from './notifications/booking-notifier.interface';
import { OfferProjectionInput, toOfferView } from './offer-projection';
import {
  BookingOffer,
  BookingOfferDocument,
  BookingOfferOutcome,
} from './schemas/booking-offer.schema';
import { Booking, BookingDocument, BookingPricingSnapshot } from './schemas/booking.schema';
import { Review, ReviewDocument } from '../reviews/schemas/review.schema';
import { subtractBusyIntervals, TimeInterval } from './subtract-busy-intervals';

const NON_TERMINAL_STATUSES = [
  BookingStatus.PENDING_WORKER,
  BookingStatus.ACCEPTED,
  BookingStatus.ON_THE_WAY,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

const MAX_BOOKING_NUMBER_ATTEMPTS = 5;

/** Escapes regex metacharacters in admin-supplied search text before it's interpolated into a $regex filter. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(BookingOffer.name) private readonly bookingOfferModel: Model<BookingOfferDocument>,
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    private readonly workerServicesService: WorkerServicesService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerAvailabilityService: WorkerAvailabilityService,
    private readonly servicesService: ServicesService,
    private readonly countriesService: CountriesService,
    private readonly pricingService: PricingService,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
    private readonly instantMatchingService: InstantMatchingService,
    // Both typed to the interface, not the concrete class — see
    // BookingAssignmentStrategy's own doc comment for the Phase 6 seam.
    // create() selects between them by dto.type; nothing else here branches
    // on booking type beyond createScheduled vs createInstant themselves.
    private readonly directAssignmentStrategy: DirectAssignmentStrategy,
    private readonly nearestAvailableAssignmentStrategy: NearestAvailableAssignmentStrategy,
    private readonly locationTrackingService: LocationTrackingService,
    private readonly walletsService: WalletsService,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
  ) {}

  async create(customerId: string, dto: CreateBookingDto): Promise<BookingDocument> {
    if (dto.type === BookingType.INSTANT) {
      return this.createInstant(customerId, dto);
    }
    return this.createScheduled(customerId, dto);
  }

  private async createScheduled(
    customerId: string,
    dto: CreateBookingDto,
  ): Promise<BookingDocument> {
    if (!dto.workerServiceId || !dto.scheduledFor) {
      throw new BadRequestException(
        'workerServiceId and scheduledFor are required for a SCHEDULED booking',
      );
    }
    const workerService = await this.workerServicesService.findActiveById(dto.workerServiceId);

    // Same "don't reveal why" visibility gate PricingService uses — a
    // customer must never be able to book a worker she couldn't otherwise see.
    const profile = await this.workerProfilesService.findApprovedById(
      workerService.workerProfileId.toString(),
    );
    if (!profile) {
      throw new NotFoundException('Worker service not found');
    }

    if (!profile.serviceAreas.some((cityId) => cityId.toString() === dto.cityId)) {
      throw new BadRequestException('This worker does not serve the selected city');
    }

    const service = await this.servicesService.findActiveById(workerService.serviceId.toString());
    const country = await this.countriesService.findActiveById(profile.countryId.toString());

    const now = new Date();
    const scheduledFor = new Date(dto.scheduledFor);
    if (scheduledFor.getTime() <= now.getTime()) {
      throw new BadRequestException('scheduledFor must be in the future');
    }
    const horizonMs = country.bookingPolicy.bookingHorizonDays * 24 * 60 * 60 * 1000;
    if (scheduledFor.getTime() - now.getTime() > horizonMs) {
      throw new BadRequestException(
        `scheduledFor may not be more than ${country.bookingPolicy.bookingHorizonDays} days in the future`,
      );
    }

    const jobEnd = new Date(scheduledFor.getTime() + dto.estimatedDurationMinutes * 60_000);
    await this.assertWithinAvailableWindow(
      profile.id as string,
      scheduledFor,
      jobEnd,
      country.timezone,
    );
    await this.assertNoOverlap(
      profile.id as string,
      scheduledFor,
      jobEnd,
      country.bookingPolicy.interBookingBufferMinutes,
    );

    const assignment = await this.directAssignmentStrategy.resolveWorker({
      workerProfileId: profile.id as string,
      workerServiceId: dto.workerServiceId,
      serviceId: service.id as string,
      countryId: country.id as string,
      cityId: dto.cityId,
      scheduledFor,
    });
    // DirectAssignmentStrategy always resolves synchronously — this is
    // never null for SCHEDULED (NearestAvailableAssignmentStrategy is the
    // one that defers). Asserted rather than re-typed, to keep
    // AssignmentResult's nullability honest for the interface as a whole.
    const workerProfileId = assignment.workerProfileId as string;

    // Never accept a price from the client — PricingService is the only
    // place this math happens, and the result is frozen into the booking.
    const quote = await this.pricingService.quote(dto.workerServiceId, {
      estimatedHours: dto.estimatedHours,
      roomCount: dto.roomCount,
    });

    const pricing: BookingPricingSnapshot = {
      pricingType: quote.breakdown.pricingType,
      hours: quote.breakdown.hours ?? null,
      roomCount: quote.breakdown.roomCount ?? null,
      basePrice: quote.basePrice,
      commissionRate: quote.breakdown.commissionRateBasisPoints,
      commissionAmount: quote.commissionAmount,
      workerEarnings: quote.workerEarnings,
      currency: quote.currency,
      hourlyRate:
        quote.breakdown.pricingType === PricingType.HOURLY
          ? (workerService.hourly?.rate ?? null)
          : null,
      minHours:
        quote.breakdown.pricingType === PricingType.HOURLY
          ? (workerService.hourly?.minHours ?? null)
          : null,
    };

    const responseDeadline = this.computeResponseDeadline(
      now,
      scheduledFor,
      country.bookingPolicy.responseDeadlineHours,
    );
    const bookingNumber = await this.generateUniqueBookingNumber();

    return this.bookingModel.create({
      bookingNumber,
      customerId,
      workerProfileId,
      serviceId: service.id,
      workerServiceId: dto.workerServiceId,
      countryId: country.id,
      cityId: dto.cityId,
      type: BookingType.SCHEDULED,
      status: BookingStatus.PENDING_WORKER,
      scheduledFor,
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      address: dto.address,
      pricing,
      finalPricing: null,
      responseDeadline,
      customerNote: dto.customerNote ?? null,
    });
  }

  private async createInstant(customerId: string, dto: CreateBookingDto): Promise<BookingDocument> {
    if (!dto.serviceId) {
      throw new BadRequestException('serviceId is required for an INSTANT booking');
    }

    // No specific worker to validate against yet — the customer picks a
    // *service*, not a worker. Her own country (not a worker's) resolves
    // which market's instantMatchingPolicy/currency applies.
    const customer = await this.usersService.findById(customerId);
    const service = await this.servicesService.findActiveById(dto.serviceId);
    const country = await this.countriesService.findActiveById(customer.countryId.toString());

    // Always resolves { workerProfileId: null } — called anyway so create()
    // has exactly one call site per strategy regardless of booking type,
    // per BookingAssignmentStrategy's own doc comment.
    await this.nearestAvailableAssignmentStrategy.resolveWorker({
      workerServiceId: '',
      serviceId: dto.serviceId,
      countryId: country.id as string,
      cityId: dto.cityId,
      scheduledFor: null,
    });

    const bookingNumber = await this.generateUniqueBookingNumber();

    const booking = await this.bookingModel.create({
      bookingNumber,
      customerId,
      workerProfileId: null,
      serviceId: service.id,
      workerServiceId: null,
      countryId: country.id,
      cityId: dto.cityId,
      type: BookingType.INSTANT,
      status: BookingStatus.SEARCHING,
      scheduledFor: null,
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      address: dto.address,
      pricing: null,
      finalPricing: null,
      pendingQuoteParams: {
        estimatedHours: dto.estimatedHours ?? null,
        roomCount: dto.roomCount ?? null,
      },
      responseDeadline: null,
      customerNote: dto.customerNote ?? null,
    });

    await this.instantMatchingService.startSearch(booking);
    return booking;
  }

  /**
   * The atomic claim that makes INSTANT acceptance race-safe: a single
   * findOneAndUpdate with `status: SEARCHING` (and `workerProfileId: null`)
   * in the filter — never read-then-write. Exactly one concurrent caller's
   * update actually matches the document; every other caller's update
   * matches zero documents and gets a neutral 409 that never implies she
   * did anything wrong, and is never recorded as a rejection anywhere.
   */
  async acceptOffer(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    this.assertValidId(bookingId);

    const booking = await this.bookingModel
      .findOneAndUpdate(
        { _id: bookingId, status: BookingStatus.SEARCHING, workerProfileId: null },
        { status: BookingStatus.ACCEPTED, workerProfileId, acceptedAt: new Date() },
        { new: true },
      )
      .exec();

    if (!booking) {
      throw new ConflictException('This request was accepted by another provider');
    }

    // Only now is it known which of her offerings applies (different
    // workers offering the same service may price it differently, or even
    // use a different pricingType) — resolve and freeze fresh, exactly the
    // same quote() call createScheduled uses, never a value trusted from
    // the offer preview sent during the broadcast.
    const workerService = await this.workerServicesService.findActiveByWorkerAndService(
      workerProfileId,
      booking.serviceId.toString(),
    );
    booking.workerServiceId = workerService._id;

    const quote = await this.pricingService.quote(workerService.id as string, {
      estimatedHours: booking.pendingQuoteParams?.estimatedHours ?? undefined,
      roomCount: booking.pendingQuoteParams?.roomCount ?? undefined,
    });

    booking.pricing = {
      pricingType: quote.breakdown.pricingType,
      hours: quote.breakdown.hours ?? null,
      roomCount: quote.breakdown.roomCount ?? null,
      basePrice: quote.basePrice,
      commissionRate: quote.breakdown.commissionRateBasisPoints,
      commissionAmount: quote.commissionAmount,
      workerEarnings: quote.workerEarnings,
      currency: quote.currency,
      hourlyRate:
        quote.breakdown.pricingType === PricingType.HOURLY
          ? (workerService.hourly?.rate ?? null)
          : null,
      minHours:
        quote.breakdown.pricingType === PricingType.HOURLY
          ? (workerService.hourly?.minHours ?? null)
          : null,
    };

    await booking.save();
    await this.instantMatchingService.resolveOffers(bookingId, workerProfileId);

    const identity = await this.resolveWorkerIdentity(workerProfileId);
    await this.notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: { workerDisplayName: identity.displayName },
    });

    return booking;
  }

  /** Backs GET /workers/me/offers — see toOfferView for exactly what she's allowed to see before accepting. */
  async listPendingOffersForWorker(workerProfileId: string): Promise<Record<string, unknown>[]> {
    const offers = await this.bookingOfferModel
      .find({ workerProfileId, outcome: BookingOfferOutcome.PENDING })
      .sort({ sentAt: -1 })
      .exec();
    if (offers.length === 0) {
      return [];
    }

    const bookingIds = offers.map((o) => o.bookingId);
    const bookings = await this.bookingModel
      .find({ _id: { $in: bookingIds }, status: BookingStatus.SEARCHING })
      .exec();
    const bookingById = new Map(bookings.map((b) => [b.id as string, b]));

    const views: Record<string, unknown>[] = [];
    for (const offer of offers) {
      const booking = bookingById.get(offer.bookingId.toString());
      if (!booking) {
        continue; // already resolved/expired by the time she's polling — not actionable
      }

      let serviceName: { ar?: string; en?: string } | null = null;
      try {
        const service = await this.servicesService.findActiveById(booking.serviceId.toString());
        serviceName = { ar: service.name.ar, en: service.name.en };
      } catch {
        serviceName = null;
      }

      const input: OfferProjectionInput = {
        id: offer.id as string,
        bookingId: booking.id as string,
        serviceId: booking.serviceId.toString(),
        serviceName,
        estimatedDurationMinutes: booking.estimatedDurationMinutes,
        estimatedPrice: offer.estimatedPrice,
        estimatedWorkerEarnings: offer.estimatedWorkerEarnings,
        currency: offer.currency,
        distanceMeters: offer.distanceMeters,
        cityId: booking.cityId.toString(),
        landmark: booking.address.landmark,
        sentAt: offer.sentAt,
        customerRating: await this.getCustomerRatingSummary(booking.customerId.toString()),
      };
      views.push(toOfferView(input));
    }
    return views;
  }

  async listOwnForCustomer(
    customerId: string,
    query: FindBookingsQueryDto,
  ): Promise<PaginatedResult<BookingDocument>> {
    const filter: Record<string, unknown> = { customerId };
    if (query.status) filter.status = query.status;
    return this.paginate(filter, query);
  }

  async getOwnForCustomer(customerId: string, bookingId: string): Promise<BookingDocument> {
    return this.loadOrThrow({ _id: this.assertValidId(bookingId), customerId });
  }

  async listOwnForWorker(
    workerProfileId: string,
    query: FindBookingsQueryDto,
  ): Promise<PaginatedResult<BookingDocument>> {
    const filter: Record<string, unknown> = { workerProfileId };
    if (query.status) filter.status = query.status;
    return this.paginate(filter, query);
  }

  async getOwnForWorker(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    return this.loadOrThrow({ _id: this.assertValidId(bookingId), workerProfileId });
  }

  /**
   * Shared by every Phase 9 module that needs "which side of this booking
   * is the caller, given only her User id" (reviews, panic, share-trip,
   * reports) — tries the customer side first, then falls back to resolving
   * her own worker profile. Neither branch failing is a NotFoundException,
   * not a Forbidden — same "a booking you're not party to simply doesn't
   * exist for you" discipline as every other lookup in this service.
   */
  async resolveOwnParty(
    userId: string,
    bookingId: string,
  ): Promise<{ booking: BookingDocument; role: Role.CUSTOMER | Role.WORKER }> {
    try {
      const booking = await this.getOwnForCustomer(userId, bookingId);
      return { booking, role: Role.CUSTOMER };
    } catch {
      // Not the customer — try the worker side.
    }

    const profile = await this.workerProfilesService.getOwn(userId);
    const booking = await this.getOwnForWorker(profile.id as string, bookingId);
    return { booking, role: Role.WORKER };
  }

  /**
   * Used by RealtimeGateway to authorize a socket joining a booking's room
   * — a user may only join rooms for bookings she is a party to, checked
   * per join, not just once at connection time. `userId` is a plain User
   * id; `Booking.customerId` is one too, but `Booking.workerProfileId` is
   * a WorkerProfile id, so the worker side needs one extra lookup. Never
   * throws — an invalid id, a missing booking, or a customer with no
   * worker profile are all simply "not a party", not an error.
   */
  async isPartyToBooking(userId: string, bookingId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return false;
    }
    const booking = await this.bookingModel
      .findOne({ _id: bookingId })
      .select('customerId workerProfileId')
      .exec();
    if (!booking) {
      return false;
    }
    if (booking.customerId.toString() === userId) {
      return true;
    }
    if (!booking.workerProfileId) {
      return false;
    }
    try {
      const profile = await this.workerProfilesService.getOwn(userId);
      return profile.id === booking.workerProfileId.toString();
    } catch {
      return false;
    }
  }

  async listForAdmin(query: AdminFindBookingsQueryDto): Promise<PaginatedResult<BookingDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.customerId) filter.customerId = query.customerId;
    if (query.workerProfileId) filter.workerProfileId = query.workerProfileId;
    if (query.countryId) filter.countryId = query.countryId;
    return this.paginate(filter, query);
  }

  async getForAdmin(bookingId: string): Promise<BookingDocument> {
    return this.loadOrThrow({ _id: this.assertValidId(bookingId) });
  }

  /** Phase 9 admin search — bookingNumber is the only field this app lets admins search bookings by directly. */
  async searchByBookingNumberPrefix(prefix: string, limit = 20): Promise<BookingDocument[]> {
    return this.bookingModel
      .find({ bookingNumber: { $regex: `^${escapeRegExp(prefix)}`, $options: 'i' } })
      .limit(limit)
      .exec();
  }

  /** Phase 9 admin dashboard — one aggregation pass, never bookings loaded into memory to count them in JS. */
  async getStatusCountsSince(since: Date): Promise<Record<string, number>> {
    const rows = await this.bookingModel.aggregate<{ _id: BookingStatus; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  }

  /** Phase 9 admin dashboard — INSTANT requests that ended NO_WORKER_FOUND, as a share of all INSTANT requests since `since`. */
  async getInstantMatchingFailureRate(
    since: Date,
  ): Promise<{ totalInstant: number; noWorkerFound: number; ratePercent: number }> {
    const [row] = await this.bookingModel.aggregate<{
      totalInstant: number;
      noWorkerFound: number;
    }>([
      { $match: { type: BookingType.INSTANT, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          totalInstant: { $sum: 1 },
          noWorkerFound: {
            $sum: { $cond: [{ $eq: ['$status', BookingStatus.NO_WORKER_FOUND] }, 1, 0] },
          },
        },
      },
    ]);
    const totalInstant = row?.totalInstant ?? 0;
    const noWorkerFound = row?.noWorkerFound ?? 0;
    return {
      totalInstant,
      noWorkerFound,
      ratePercent: totalInstant === 0 ? 0 : Math.round((noWorkerFound / totalInstant) * 1000) / 10,
    };
  }

  /**
   * Phase 9 operational metrics — average accept latency, completion rate,
   * and cancellation rate by party, all from one aggregation pass against
   * bookings created since `since`. "Completion rate" and "cancellation
   * rate" are both out of every booking in the window (not just terminal
   * ones) — a booking still in flight simply counts toward neither yet.
   */
  async getOperationalMetrics(since: Date): Promise<{
    totalBookings: number;
    averageTimeToAcceptMinutes: number | null;
    completionRate: number;
    cancellationRateByCustomer: number;
    cancellationRateByWorker: number;
  }> {
    const [row] = await this.bookingModel.aggregate<{
      total: number;
      completed: number;
      cancelledByCustomer: number;
      cancelledByWorker: number;
      acceptedCount: number;
      totalAcceptLatencyMs: number;
    }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', BookingStatus.COMPLETED] }, 1, 0] } },
          cancelledByCustomer: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', BookingStatus.CANCELLED] },
                    { $eq: ['$cancellation.byRole', Role.CUSTOMER] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          cancelledByWorker: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', BookingStatus.CANCELLED] },
                    { $eq: ['$cancellation.byRole', Role.WORKER] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          acceptedCount: { $sum: { $cond: [{ $ne: ['$acceptedAt', null] }, 1, 0] } },
          totalAcceptLatencyMs: {
            $sum: {
              $cond: [
                { $ne: ['$acceptedAt', null] },
                { $subtract: ['$acceptedAt', '$createdAt'] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const total = row?.total ?? 0;
    if (total === 0) {
      return {
        totalBookings: 0,
        averageTimeToAcceptMinutes: null,
        completionRate: 0,
        cancellationRateByCustomer: 0,
        cancellationRateByWorker: 0,
      };
    }

    return {
      totalBookings: total,
      averageTimeToAcceptMinutes:
        row!.acceptedCount === 0
          ? null
          : Math.round(row!.totalAcceptLatencyMs / row!.acceptedCount / 60_000),
      completionRate: Math.round((row!.completed / total) * 1000) / 10,
      cancellationRateByCustomer: Math.round((row!.cancelledByCustomer / total) * 1000) / 10,
      cancellationRateByWorker: Math.round((row!.cancelledByWorker / total) * 1000) / 10,
    };
  }

  async accept(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.ACCEPT, 'WORKER');
    booking.acceptedAt = new Date();
    await booking.save();

    const identity = await this.resolveWorkerIdentity(workerProfileId);
    await this.notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: { workerDisplayName: identity.displayName },
    });

    return booking;
  }

  async reject(
    workerProfileId: string,
    bookingId: string,
    reason: string,
  ): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.REJECT, 'WORKER');
    booking.rejectionReason = reason;
    await booking.save();
    return booking;
  }

  async onTheWay(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.ON_THE_WAY, 'WORKER');
    await booking.save();

    await this.notifier.notify({
      type: NotificationEventType.WORKER_ON_THE_WAY,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: {},
    });

    return booking;
  }

  async arrived(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.ARRIVED, 'WORKER');
    await booking.save();

    await this.locationTrackingService.recordArrivalDistance(bookingId, booking.address.point);

    await this.notifier.notify({
      type: NotificationEventType.WORKER_ARRIVED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: {},
    });

    return booking;
  }

  async start(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.START, 'WORKER');
    booking.startedAt = new Date();
    await booking.save();

    await this.notifier.notify({
      type: NotificationEventType.JOB_STARTED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: {},
    });

    return booking;
  }

  /** The "swipe to finish" action — recomputes HOURLY from actual elapsed time; BY_SIZE/FIXED just copy the snapshot forward. */
  async complete(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.COMPLETE, 'WORKER');
    booking.completedAt = new Date();

    const elapsedHours = (booking.completedAt.getTime() - booking.startedAt!.getTime()) / 3_600_000;
    // pricing is guaranteed set by the time a booking reaches IN_PROGRESS —
    // SCHEDULED freezes it at creation, INSTANT at acceptance — so this is
    // never actually null in practice, just not something TS can see from
    // the schema's necessarily-nullable type.
    booking.finalPricing = computeFinalPricing(booking.pricing!, elapsedHours);

    await booking.save();
    await this.locationTrackingService.markTerminated(bookingId);
    await this.chargeCommissionSafely(booking);
    await this.recomputeCompletedBookingsCountSafely(booking.workerProfileId!.toString());

    await this.notifier.notify({
      type: NotificationEventType.JOB_COMPLETED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: {},
    });

    return booking;
  }

  /**
   * The booking has already been saved as COMPLETED by the time this runs —
   * a ledger failure here must never undo that or propagate to the caller.
   * On failure it's logged and audit-logged (actorUserId null — this is a
   * system action) with commissionChargedAt left null, which is exactly
   * what CommissionChargeRetrySweepService polls for.
   */
  private async chargeCommissionSafely(booking: BookingDocument): Promise<void> {
    try {
      await this.walletsService.chargeCommission(
        booking.id as string,
        booking.workerProfileId!.toString(),
        booking.finalPricing!.commissionAmount,
        booking.finalPricing!.currency,
      );
      booking.commissionChargedAt = new Date();
      await booking.save();
    } catch (error) {
      this.logger.error(
        `Failed to charge commission for completed booking ${booking.id}`,
        (error as Error).stack,
      );
      await this.auditLogService.record({
        actorUserId: null,
        action: AuditAction.WALLET_COMMISSION_CHARGE_FAILED,
        targetType: 'Booking',
        targetId: booking.id as string,
        metadata: { error: (error as Error).message },
      });
    }
  }

  /**
   * Phase 9: WorkerProfile.completedBookings is denormalized for fast
   * reads, but this (a full recount against the Booking collection) is the
   * only thing that may ever write it — never a blind increment, so a
   * double-complete or a missed one can't drift it. Never blocks
   * completion: a stats write failing is logged, not fatal.
   */
  private async recomputeCompletedBookingsCountSafely(workerProfileId: string): Promise<void> {
    try {
      const count = await this.bookingModel
        .countDocuments({ workerProfileId, status: BookingStatus.COMPLETED })
        .exec();
      await this.workerProfilesService.setCompletedBookingsCount(workerProfileId, count);
    } catch (error) {
      this.logger.error(
        `Failed to recompute completedBookings for worker profile ${workerProfileId}`,
        (error as Error).stack,
      );
    }
  }

  async cancelByCustomer(
    customerId: string,
    bookingId: string,
    reason: string,
  ): Promise<BookingDocument> {
    const booking = await this.getOwnForCustomer(customerId, bookingId);
    const previousStatus = booking.status;
    booking.status = assertValidAction(booking.status, BookingAction.CUSTOMER_CANCEL, 'CUSTOMER');

    // No worker was ever committed while SEARCHING (INSTANT) — no fee,
    // regardless of the country's policy. Otherwise (SCHEDULED, or an
    // INSTANT booking already matched to a worker) the usual policy applies.
    let feeAmount = 0;
    if (previousStatus !== BookingStatus.SEARCHING) {
      const country = await this.countriesService.findActiveById(booking.countryId.toString());
      feeAmount = this.computeCustomerCancellationFee(booking, country.bookingPolicy);
    }

    booking.cancelledAt = new Date();
    booking.cancellation = {
      byUserId: customerId as unknown as Types.ObjectId,
      byRole: Role.CUSTOMER,
      reason,
      feeAmount,
    };
    await booking.save();
    await this.locationTrackingService.markTerminated(bookingId);

    if (previousStatus === BookingStatus.SEARCHING) {
      await this.instantMatchingService.markOutstandingOffersStale(bookingId);
    } else if (booking.workerProfileId) {
      const identity = await this.resolveWorkerIdentity(booking.workerProfileId.toString());
      await this.notifier.notify({
        type: NotificationEventType.BOOKING_CANCELLED,
        recipientUserId: identity.userId,
        bookingId,
        context: { reason },
      });
    }

    return booking;
  }

  /**
   * No fee is charged to the customer when the worker cancels after
   * accepting — it's only recorded (feeds her reliability score in a later
   * phase). She may, per Phase 8, owe a CANCELLATION_FEE to her own wallet
   * instead — a country-configured penalty, zero by default. A wallet
   * failure here is logged but never blocks the cancellation itself; unlike
   * a completed job's commission, there's no retry sweep for this penalty
   * (it isn't revenue the booking has already earned — a missed charge
   * here is a lenience, not a liability).
   */
  async cancelByWorker(
    workerProfileId: string,
    actorUserId: string,
    bookingId: string,
    reason: string,
  ): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.WORKER_CANCEL, 'WORKER');

    booking.cancelledAt = new Date();
    booking.cancellation = {
      byUserId: actorUserId as unknown as Types.ObjectId,
      byRole: Role.WORKER,
      reason,
      feeAmount: 0,
    };
    await booking.save();
    await this.locationTrackingService.markTerminated(bookingId);

    try {
      const country = await this.countriesService.findActiveById(booking.countryId.toString());
      await this.walletsService.chargeCancellationPenalty(
        bookingId,
        workerProfileId,
        country.walletPolicy.workerCancellationPenaltyAmount,
        booking.pricing!.currency,
      );
    } catch (error) {
      this.logger.error(
        `Failed to charge worker cancellation penalty for booking ${bookingId}`,
        (error as Error).stack,
      );
    }

    await this.notifier.notify({
      type: NotificationEventType.BOOKING_CANCELLED,
      recipientUserId: booking.customerId.toString(),
      bookingId,
      context: { reason },
    });

    return booking;
  }

  async forceStatus(
    adminUserId: string,
    bookingId: string,
    dto: ForceBookingStatusDto,
  ): Promise<BookingDocument> {
    const booking = await this.getForAdmin(bookingId);
    const action =
      dto.status === BookingStatus.CANCELLED
        ? BookingAction.ADMIN_FORCE_CANCELLED
        : BookingAction.ADMIN_FORCE_NO_SHOW;
    const previousStatus = booking.status;
    booking.status = assertValidAction(previousStatus, action, 'ADMIN');

    if (booking.status === BookingStatus.CANCELLED) {
      booking.cancelledAt = new Date();
    }
    booking.cancellation = {
      byUserId: adminUserId as unknown as Types.ObjectId,
      byRole: Role.ADMIN,
      reason: dto.reason,
      feeAmount: 0,
    };
    await booking.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action:
        booking.status === BookingStatus.CANCELLED
          ? AuditAction.BOOKING_FORCE_CANCELLED
          : AuditAction.BOOKING_FORCE_NO_SHOW,
      targetType: 'Booking',
      targetId: bookingId,
      metadata: { from: previousStatus, to: booking.status, reason: dto.reason },
    });

    // Both outcomes here are terminal with respect to tracking.
    await this.locationTrackingService.markTerminated(bookingId);

    if (booking.status === BookingStatus.CANCELLED) {
      await this.notifier.notify({
        type: NotificationEventType.BOOKING_CANCELLED,
        recipientUserId: booking.customerId.toString(),
        bookingId,
        context: { reason: dto.reason },
      });
      if (booking.workerProfileId) {
        const identity = await this.resolveWorkerIdentity(booking.workerProfileId.toString());
        await this.notifier.notify({
          type: NotificationEventType.BOOKING_CANCELLED,
          recipientUserId: identity.userId,
          bookingId,
          context: { reason: dto.reason },
        });
      }
    }

    return booking;
  }

  /** Looked up by BookingsController to build the status-dependent projection — never scoped, callers already own the authorization decision. */
  async getWorkerPhone(workerProfileId: string): Promise<string | null> {
    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    const user = await this.usersService.findById(profile.userId.toString());
    return user.phone;
  }

  async getCustomerPhone(customerId: string): Promise<string | null> {
    const user = await this.usersService.findById(customerId);
    return user.phone;
  }

  async projectForCustomer(booking: BookingDocument): Promise<Record<string, unknown>> {
    // No worker assigned yet (INSTANT, still SEARCHING) -> nothing to fetch.
    const workerPhone = booking.workerProfileId
      ? await this.getWorkerPhone(booking.workerProfileId.toString())
      : null;
    return toBookingView(this.toProjectionInput(booking), 'CUSTOMER', {
      workerPhone,
      customerPhone: null,
    });
  }

  async projectForWorker(booking: BookingDocument): Promise<Record<string, unknown>> {
    const [customerPhone, customerRating] = await Promise.all([
      this.getCustomerPhone(booking.customerId.toString()),
      this.getCustomerRatingSummary(booking.customerId.toString()),
    ]);
    return toBookingView(this.toProjectionInput(booking), 'WORKER', {
      workerPhone: null,
      customerPhone,
      customerRating,
    });
  }

  async projectForAdmin(booking: BookingDocument): Promise<Record<string, unknown>> {
    const [workerPhone, customerPhone, customerRating] = await Promise.all([
      booking.workerProfileId ? this.getWorkerPhone(booking.workerProfileId.toString()) : null,
      this.getCustomerPhone(booking.customerId.toString()),
      this.getCustomerRatingSummary(booking.customerId.toString()),
    ]);
    return toBookingView(this.toProjectionInput(booking), 'ADMIN', {
      workerPhone,
      customerPhone,
      customerRating,
    });
  }

  /**
   * Phase 9: "visible only to workers deciding whether to accept, and to
   * admins" — never computed for the CUSTOMER viewer (projectForCustomer
   * never calls this). Reads the Review collection directly via a model
   * registered locally in BookingsModule rather than importing
   * ReviewsModule, which would need to import BookingsModule right back
   * (ReviewsService needs Booking for eligibility checks) — the same
   * "register the schema where it's read, don't import the owning module"
   * choice used throughout this app to avoid circular module graphs.
   */
  private async getCustomerRatingSummary(
    customerId: string,
  ): Promise<CustomerRatingSummary | null> {
    if (!Types.ObjectId.isValid(customerId)) {
      return null;
    }
    const [result] = await this.reviewModel.aggregate<{ average: number; count: number }>([
      {
        $match: {
          subjectId: new Types.ObjectId(customerId),
          authorRole: Role.WORKER,
          isHidden: false,
          isDeleted: false,
        },
      },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (!result || result.count === 0) {
      return null;
    }
    return { average: Math.round(result.average * 10) / 10, count: result.count };
  }

  async projectMany(
    bookings: BookingDocument[],
    viewer: BookingViewer,
  ): Promise<Record<string, unknown>[]> {
    const projector =
      viewer === 'CUSTOMER'
        ? this.projectForCustomer.bind(this)
        : viewer === 'WORKER'
          ? this.projectForWorker.bind(this)
          : this.projectForAdmin.bind(this);
    // N+1 phone lookups per page — acceptable at this phase's scale (small,
    // paginated lists), same documented tradeoff as the Phase 4 public
    // worker listing's in-memory price sort. Revisit with a batch lookup if
    // list endpoints need to scale further.
    return Promise.all(bookings.map((booking) => projector(booking)));
  }

  /**
   * Free windows for one calendar date (her country timezone), with her
   * existing non-terminal bookings — each expanded by the inter-booking
   * buffer — subtracted out. Same visibility gate as booking creation: a
   * customer must never be able to see slots for a worker she couldn't
   * otherwise book.
   */
  async getFreeSlots(workerProfileId: string, isoDate: string): Promise<TimeInterval[]> {
    const profile = await this.workerProfilesService.findApprovedById(workerProfileId);
    if (!profile) {
      throw new NotFoundException('Worker not found');
    }

    const country = await this.countriesService.findActiveById(profile.countryId.toString());
    const windows = await this.workerAvailabilityService.getWindowsForDate(
      workerProfileId,
      isoDate,
      country.timezone,
    );
    if (windows.length === 0) {
      return [];
    }

    const bufferMs = country.bookingPolicy.interBookingBufferMinutes * 60_000;
    const earliestWindowStart = Math.min(...windows.map((w) => w.start.getTime()));
    const latestWindowEnd = Math.max(...windows.map((w) => w.end.getTime()));
    const lookupStart = new Date(earliestWindowStart - bufferMs);
    const lookupEnd = new Date(latestWindowEnd + bufferMs);

    const existingBookings = await this.bookingModel
      .find({
        workerProfileId,
        status: { $in: NON_TERMINAL_STATUSES },
        scheduledFor: { $gte: lookupStart, $lte: lookupEnd },
      })
      .exec();

    const busy: TimeInterval[] = existingBookings.map((b) => ({
      start: new Date(b.scheduledFor!.getTime() - bufferMs),
      end: new Date(b.scheduledFor!.getTime() + b.estimatedDurationMinutes * 60_000 + bufferMs),
    }));

    return subtractBusyIntervals(windows, busy);
  }

  /** One profile+user lookup, reused by every notify() call site that needs the worker's userId and/or a display name for the customer-facing copy. */
  private async resolveWorkerIdentity(
    workerProfileId: string,
  ): Promise<{ userId: string; displayName?: string }> {
    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    const userId = profile.userId.toString();
    const user = await this.usersService.findById(userId);
    return { userId, displayName: user.profile?.firstName };
  }

  private toProjectionInput(booking: BookingDocument): BookingProjectionInput {
    return {
      id: booking.id as string,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId.toString(),
      workerProfileId: booking.workerProfileId ? booking.workerProfileId.toString() : null,
      serviceId: booking.serviceId.toString(),
      workerServiceId: booking.workerServiceId ? booking.workerServiceId.toString() : null,
      countryId: booking.countryId.toString(),
      cityId: booking.cityId.toString(),
      type: booking.type,
      status: booking.status,
      scheduledFor: booking.scheduledFor,
      estimatedDurationMinutes: booking.estimatedDurationMinutes,
      address: booking.address,
      pricing: booking.pricing,
      finalPricing: booking.finalPricing,
      responseDeadline: booking.responseDeadline,
      acceptedAt: booking.acceptedAt,
      startedAt: booking.startedAt,
      completedAt: booking.completedAt,
      cancelledAt: booking.cancelledAt,
      cancellation: booking.cancellation
        ? {
            byUserId: booking.cancellation.byUserId.toString(),
            byRole: booking.cancellation.byRole,
            reason: booking.cancellation.reason,
            feeAmount: booking.cancellation.feeAmount,
          }
        : null,
      rejectionReason: booking.rejectionReason,
      customerNote: booking.customerNote,
    };
  }

  private async paginate(
    filter: Record<string, unknown>,
    query: FindBookingsQueryDto | AdminFindBookingsQueryDto,
  ): Promise<PaginatedResult<BookingDocument>> {
    const [data, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  private async loadOrThrow(filter: Record<string, unknown>): Promise<BookingDocument> {
    const booking = await this.bookingModel.findOne(filter).exec();
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private assertValidId(id: string): string {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Booking not found');
    }
    return id;
  }

  private computeResponseDeadline(
    now: Date,
    scheduledFor: Date,
    responseDeadlineHours: number,
  ): Date {
    const candidate = new Date(now.getTime() + responseDeadlineHours * 3_600_000);
    return candidate.getTime() < scheduledFor.getTime() ? candidate : scheduledFor;
  }

  /**
   * "More than N hours before scheduledFor" is free; AT or inside that
   * window incurs the fee — the boundary itself belongs to the fee side,
   * not the free side. Only called once a worker is already committed (see
   * cancelByCustomer), so `pricing` is guaranteed set. An INSTANT booking
   * has no scheduledFor at all once matched — the job is either happening
   * now or about to, so that case is treated the same as "inside the
   * window" rather than "more than N hours away".
   */
  private computeCustomerCancellationFee(
    booking: BookingDocument,
    policy: CountryBookingPolicy,
  ): number {
    if (booking.scheduledFor) {
      const hoursUntil = (booking.scheduledFor.getTime() - Date.now()) / 3_600_000;
      if (hoursUntil > policy.freeCancellationHours) {
        return 0;
      }
    }
    return roundHalfUpDivide(booking.pricing!.basePrice * policy.cancellationFeeBasisPoints, 10000);
  }

  private async assertWithinAvailableWindow(
    workerProfileId: string,
    jobStart: Date,
    jobEnd: Date,
    timezone: string,
  ): Promise<void> {
    const isoDate = DateTime.fromJSDate(jobStart, { zone: timezone }).toISODate() as string;
    const windows = await this.workerAvailabilityService.getWindowsForDate(
      workerProfileId,
      isoDate,
      timezone,
    );
    const fits = windows.some(
      (w) => jobStart.getTime() >= w.start.getTime() && jobEnd.getTime() <= w.end.getTime(),
    );
    if (!fits) {
      throw new BadRequestException('scheduledFor falls outside her available hours for that date');
    }
  }

  private async assertNoOverlap(
    workerProfileId: string,
    jobStart: Date,
    jobEnd: Date,
    bufferMinutes: number,
  ): Promise<void> {
    const bufferMs = bufferMinutes * 60_000;
    const candidateStart = jobStart.getTime() - bufferMs;
    const candidateEnd = jobEnd.getTime() + bufferMs;

    const existingBookings = await this.bookingModel
      .find({
        workerProfileId,
        status: { $in: NON_TERMINAL_STATUSES },
        scheduledFor: { $ne: null },
      })
      .exec();

    for (const existing of existingBookings) {
      const existingStart = existing.scheduledFor!.getTime() - bufferMs;
      const existingEnd =
        existing.scheduledFor!.getTime() + existing.estimatedDurationMinutes * 60_000 + bufferMs;
      if (candidateStart < existingEnd && existingStart < candidateEnd) {
        throw new ConflictException(
          'This time overlaps one of her existing bookings (including the travel buffer between jobs)',
        );
      }
    }
  }

  private async generateUniqueBookingNumber(): Promise<string> {
    for (let attempt = 0; attempt < MAX_BOOKING_NUMBER_ATTEMPTS; attempt++) {
      const candidate = generateBookingNumber();
      const exists = await this.bookingModel.exists({ bookingNumber: candidate });
      if (!exists) {
        return candidate;
      }
    }
    throw new ConflictException('Could not generate a unique booking number — please retry');
  }
}
