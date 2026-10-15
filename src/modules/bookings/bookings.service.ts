import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { PricingService } from '../pricing/pricing.service';
import { roundHalfUpDivide } from '../pricing/round-half-up-divide';
import { ServicesService } from '../services/services.service';
import { UsersService } from '../users/users.service';
import { WorkerAvailabilityService } from '../workers/worker-availability.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { BookingAction, assertValidAction } from './booking.state-machine';
import { computeFinalPricing } from './compute-final-pricing';
import { AdminFindBookingsQueryDto } from './dto/admin-find-bookings-query.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FindBookingsQueryDto } from './dto/find-bookings-query.dto';
import { ForceBookingStatusDto } from './dto/force-booking-status.dto';
import { generateBookingNumber } from './generate-booking-number';
import { Booking, BookingDocument, BookingPricingSnapshot } from './schemas/booking.schema';

const NON_TERMINAL_STATUSES = [
  BookingStatus.PENDING_WORKER,
  BookingStatus.ACCEPTED,
  BookingStatus.ON_THE_WAY,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

const MAX_BOOKING_NUMBER_ATTEMPTS = 5;

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly workerServicesService: WorkerServicesService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerAvailabilityService: WorkerAvailabilityService,
    private readonly servicesService: ServicesService,
    private readonly countriesService: CountriesService,
    private readonly pricingService: PricingService,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
    // Typed to the interface, not the concrete class — see
    // BookingAssignmentStrategy's own doc comment for the Phase 6 seam.
    // SCHEDULED is the only creatable type in this phase, so there's only
    // one implementation wired in; Phase 6 adds a sibling strategy for
    // INSTANT and branches on dto.type here, without touching anything below.
    private readonly assignmentStrategy: DirectAssignmentStrategy,
  ) {}

  async create(customerId: string, dto: CreateBookingDto): Promise<BookingDocument> {
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

    const assignment = await this.assignmentStrategy.resolveWorker({
      workerProfileId: profile.id as string,
      workerServiceId: dto.workerServiceId,
      serviceId: service.id as string,
      countryId: country.id as string,
      cityId: dto.cityId,
      scheduledFor,
    });

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
      workerProfileId: assignment.workerProfileId,
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

  async accept(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.ACCEPT, 'WORKER');
    booking.acceptedAt = new Date();
    await booking.save();
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
    return booking;
  }

  async arrived(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.ARRIVED, 'WORKER');
    await booking.save();
    return booking;
  }

  async start(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.START, 'WORKER');
    booking.startedAt = new Date();
    await booking.save();
    return booking;
  }

  /** The "swipe to finish" action — recomputes HOURLY from actual elapsed time; BY_SIZE/FIXED just copy the snapshot forward. */
  async complete(workerProfileId: string, bookingId: string): Promise<BookingDocument> {
    const booking = await this.getOwnForWorker(workerProfileId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.COMPLETE, 'WORKER');
    booking.completedAt = new Date();

    const elapsedHours = (booking.completedAt.getTime() - booking.startedAt!.getTime()) / 3_600_000;
    booking.finalPricing = computeFinalPricing(booking.pricing, elapsedHours);

    await booking.save();
    return booking;
  }

  async cancelByCustomer(
    customerId: string,
    bookingId: string,
    reason: string,
  ): Promise<BookingDocument> {
    const booking = await this.getOwnForCustomer(customerId, bookingId);
    booking.status = assertValidAction(booking.status, BookingAction.CUSTOMER_CANCEL, 'CUSTOMER');

    const country = await this.countriesService.findActiveById(booking.countryId.toString());
    const feeAmount = this.computeCustomerCancellationFee(booking, country.bookingPolicy);

    booking.cancelledAt = new Date();
    booking.cancellation = {
      byUserId: customerId as unknown as Types.ObjectId,
      byRole: Role.CUSTOMER,
      reason,
      feeAmount,
    };
    await booking.save();
    return booking;
  }

  /** No fee is charged to the customer when the worker cancels after accepting — it's only recorded (feeds her reliability score in a later phase). */
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
   * not the free side.
   */
  private computeCustomerCancellationFee(
    booking: BookingDocument,
    policy: CountryBookingPolicy,
  ): number {
    const hoursUntil = (booking.scheduledFor!.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil > policy.freeCancellationHours) {
      return 0;
    }
    return roundHalfUpDivide(booking.pricing.basePrice * policy.cancellationFeeBasisPoints, 10000);
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
