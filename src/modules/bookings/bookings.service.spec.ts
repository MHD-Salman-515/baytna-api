import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { PricingService } from '../pricing/pricing.service';
import { ServicesService } from '../services/services.service';
import { UsersService } from '../users/users.service';
import { WorkerAvailabilityService } from '../workers/worker-availability.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { BookingsService } from './bookings.service';
import { Booking } from './schemas/booking.schema';

const bookingId = new Types.ObjectId().toString();

function chainable(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['sort', 'skip', 'limit'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function fakeBooking(overrides: Record<string, unknown> = {}) {
  const booking: Record<string, unknown> = {
    _id: bookingId,
    status: BookingStatus.PENDING_WORKER,
    scheduledFor: new Date('2026-12-01T10:00:00.000Z'),
    estimatedDurationMinutes: 120,
    countryId: 'country-1',
    workerServiceId: 'worker-service-1',
    pricing: {
      pricingType: PricingType.HOURLY,
      hours: 2,
      roomCount: null,
      basePrice: 6000,
      commissionRate: 1500,
      commissionAmount: 900,
      workerEarnings: 5100,
      currency: 'SYP',
      hourlyRate: 3000,
      minHours: 2,
    },
    finalPricing: null,
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellation: null,
    rejectionReason: null,
    save: jest.fn(),
    ...overrides,
  };
  booking.save = jest.fn().mockResolvedValue(booking);
  return booking;
}

describe('BookingsService', () => {
  let service: BookingsService;
  let bookingModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    countDocuments: jest.Mock;
    exists: jest.Mock;
  };
  let workerServicesService: { findActiveById: jest.Mock };
  let workerProfilesService: { findApprovedById: jest.Mock; getForAdmin: jest.Mock };
  let workerAvailabilityService: { getWindowsForDate: jest.Mock };
  let servicesService: { findActiveById: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };
  let pricingService: { quote: jest.Mock };
  let usersService: { findById: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let assignmentStrategy: { resolveWorker: jest.Mock };

  const workerServiceId = 'worker-service-1';
  const cityId = 'city-1';
  const customerId = 'customer-1';
  const workerProfileId = 'worker-profile-1';

  const workerService = {
    _id: workerServiceId,
    workerProfileId,
    serviceId: 'service-1',
    pricingType: PricingType.HOURLY,
    hourly: { rate: 3000, minHours: 2 },
  };

  const profile = {
    id: workerProfileId,
    countryId: 'country-1',
    serviceAreas: [{ toString: () => cityId }],
    userId: 'worker-user-1',
  };

  const country = {
    id: 'country-1',
    timezone: 'Asia/Damascus',
    bookingPolicy: {
      responseDeadlineHours: 12,
      bookingHorizonDays: 90,
      interBookingBufferMinutes: 30,
      freeCancellationHours: 24,
      cancellationFeeBasisPoints: 2000,
    },
  };

  const service_ = { id: 'service-1' };

  const quote = {
    basePrice: 6000,
    commissionAmount: 900,
    workerEarnings: 5100,
    currency: 'SYP',
    breakdown: {
      pricingType: PricingType.HOURLY,
      hours: 2,
      commissionRateBasisPoints: 1500,
    },
  };

  beforeEach(async () => {
    bookingModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      countDocuments: jest.fn(),
      exists: jest.fn(),
    };
    workerServicesService = { findActiveById: jest.fn().mockResolvedValue(workerService) };
    workerProfilesService = {
      findApprovedById: jest.fn().mockResolvedValue(profile),
      getForAdmin: jest.fn().mockResolvedValue(profile),
    };
    workerAvailabilityService = {
      getWindowsForDate: jest.fn().mockResolvedValue([
        {
          start: new Date('2026-12-01T06:00:00.000Z'),
          end: new Date('2026-12-01T14:00:00.000Z'),
        },
      ]),
    };
    servicesService = { findActiveById: jest.fn().mockResolvedValue(service_) };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(country) };
    pricingService = { quote: jest.fn().mockResolvedValue(quote) };
    usersService = { findById: jest.fn().mockResolvedValue({ phone: '+963900000000' }) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    assignmentStrategy = {
      resolveWorker: jest.fn().mockResolvedValue({ workerProfileId }),
    };

    bookingModel.find.mockReturnValue(chainable([]));
    bookingModel.exists.mockResolvedValue(null);
    bookingModel.create.mockImplementation((doc) => Promise.resolve({ ...doc, id: 'new-booking' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: WorkerServicesService, useValue: workerServicesService },
        { provide: WorkerProfilesService, useValue: workerProfilesService },
        { provide: WorkerAvailabilityService, useValue: workerAvailabilityService },
        { provide: ServicesService, useValue: servicesService },
        { provide: CountriesService, useValue: countriesService },
        { provide: PricingService, useValue: pricingService },
        { provide: UsersService, useValue: usersService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: DirectAssignmentStrategy, useValue: assignmentStrategy },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  function validCreateDto(overrides: Record<string, unknown> = {}) {
    return {
      workerServiceId,
      cityId,
      scheduledFor: '2026-12-01T10:00:00.000Z',
      estimatedDurationMinutes: 120,
      estimatedHours: 2,
      address: {
        point: { type: 'Point', coordinates: [36.3, 33.5] },
        text: 'Street 1',
        landmark: 'Blue mosque',
      },
      ...overrides,
    } as never;
  }

  describe('create', () => {
    it('creates a SCHEDULED booking with a frozen pricing snapshot, including the frozen hourly rate/minHours', async () => {
      const created = await service.create(customerId, validCreateDto());

      expect(bookingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId,
          workerProfileId,
          serviceId: 'service-1',
          workerServiceId,
          countryId: 'country-1',
          cityId,
          status: BookingStatus.PENDING_WORKER,
          pricing: expect.objectContaining({
            basePrice: 6000,
            commissionAmount: 900,
            workerEarnings: 5100,
            hourlyRate: 3000,
            minHours: 2,
          }),
          finalPricing: null,
        }),
      );
      expect(created).toBeDefined();
    });

    it('rejects booking a city outside the worker serviceAreas', async () => {
      await expect(
        service.create(customerId, validCreateDto({ cityId: 'some-other-city' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a scheduledFor in the past', async () => {
      await expect(
        service.create(customerId, validCreateDto({ scheduledFor: '2020-01-01T00:00:00.000Z' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a scheduledFor beyond the booking horizon', async () => {
      const farFuture = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();
      await expect(
        service.create(customerId, validCreateDto({ scheduledFor: farFuture })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a job that falls outside her available window', async () => {
      workerAvailabilityService.getWindowsForDate.mockResolvedValue([]);
      await expect(service.create(customerId, validCreateDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when it overlaps an existing non-terminal booking, including the inter-booking buffer', async () => {
      // Existing booking 10:00-12:00 + 30min buffer each side -> busy 09:30-12:30.
      // New booking requested 10:00-12:00 overlaps directly.
      bookingModel.find.mockReturnValue(
        chainable([
          {
            scheduledFor: new Date('2026-12-01T10:00:00.000Z'),
            estimatedDurationMinutes: 120,
          },
        ]),
      );
      await expect(service.create(customerId, validCreateDto())).rejects.toThrow(ConflictException);
    });

    it('accepts a back-to-back booking that clears the buffer exactly', async () => {
      // Existing booking 06:00-08:00 (+30min buffer -> busy until 08:30). New
      // job starts at 10:00 — comfortably clear.
      bookingModel.find.mockReturnValue(
        chainable([
          {
            scheduledFor: new Date('2026-12-01T06:00:00.000Z'),
            estimatedDurationMinutes: 120,
          },
        ]),
      );
      await expect(service.create(customerId, validCreateDto())).resolves.toBeDefined();
    });

    it('is unaffected by a later change to the quote (pricing is frozen at creation, never re-read)', async () => {
      await service.create(customerId, validCreateDto());
      const firstCallArg = bookingModel.create.mock.calls[0][0];
      expect(firstCallArg.pricing.basePrice).toBe(6000);

      // Simulate "the worker raised her rate" for any future quote() call.
      pricingService.quote.mockResolvedValue({
        ...quote,
        basePrice: 99999,
        breakdown: { ...quote.breakdown },
      });

      // The booking created above never gets re-read or re-priced by that change.
      expect(firstCallArg.pricing.basePrice).toBe(6000);
    });

    it('retries booking number generation on a collision', async () => {
      bookingModel.exists.mockResolvedValueOnce({ _id: 'collides' }).mockResolvedValueOnce(null);
      await service.create(customerId, validCreateDto());
      expect(bookingModel.exists).toHaveBeenCalledTimes(2);
    });

    it('does not reveal why when the worker is not publicly visible (same gate as pricing/public listing)', async () => {
      workerProfilesService.findApprovedById.mockResolvedValue(null);
      await expect(service.create(customerId, validCreateDto())).rejects.toThrow(NotFoundException);
    });
  });

  describe('ownership scoping', () => {
    it('getOwnForWorker throws NotFound when the booking belongs to someone else', async () => {
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.getOwnForWorker('not-her-profile', bookingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(bookingModel.findOne).toHaveBeenCalledWith({
        _id: bookingId,
        workerProfileId: 'not-her-profile',
      });
    });

    it('getOwnForCustomer throws NotFound when the booking belongs to someone else', async () => {
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.getOwnForCustomer('not-her-id', bookingId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('worker lifecycle transitions', () => {
    it('accept sets ACCEPTED and acceptedAt', async () => {
      const booking = fakeBooking();
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.accept(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.ACCEPTED);
      expect(booking.acceptedAt).toBeInstanceOf(Date);
      expect(booking.save).toHaveBeenCalled();
    });

    it('reject sets REJECTED and stores the reason', async () => {
      const booking = fakeBooking();
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.reject(workerProfileId, bookingId, 'Too far');

      expect(booking.status).toBe(BookingStatus.REJECTED);
      expect(booking.rejectionReason).toBe('Too far');
    });

    it('a transition from an illegal status is rejected and nothing is saved', async () => {
      const booking = fakeBooking({ status: BookingStatus.COMPLETED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await expect(service.accept(workerProfileId, bookingId)).rejects.toThrow(BadRequestException);
      expect(booking.save).not.toHaveBeenCalled();
    });

    it('start sets IN_PROGRESS and startedAt', async () => {
      const booking = fakeBooking({ status: BookingStatus.ARRIVED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.start(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.IN_PROGRESS);
      expect(booking.startedAt).toBeInstanceOf(Date);
    });

    it('complete recomputes finalPricing for HOURLY from actual elapsed time, using the frozen rate', async () => {
      const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
      const booking = fakeBooking({ status: BookingStatus.IN_PROGRESS, startedAt });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.complete(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.COMPLETED);
      expect(booking.completedAt).toBeInstanceOf(Date);
      expect((booking.finalPricing as Record<string, unknown>).basePrice).toBe(9000); // 3000 * 3h
      expect((booking.finalPricing as Record<string, unknown>).hourlyRate).toBe(3000);
    });

    it('complete enforces minHours on the actual elapsed time', async () => {
      const startedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago, well under minHours=2
      const booking = fakeBooking({ status: BookingStatus.IN_PROGRESS, startedAt });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.complete(workerProfileId, bookingId);

      expect((booking.finalPricing as Record<string, unknown>).hours).toBe(2); // clamped to minHours
      expect((booking.finalPricing as Record<string, unknown>).basePrice).toBe(6000); // 3000 * 2
    });

    it('complete for FIXED pricing just carries the snapshot forward unchanged', async () => {
      const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const fixedPricing = {
        pricingType: PricingType.FIXED,
        hours: null,
        roomCount: null,
        basePrice: 15000,
        commissionRate: 1500,
        commissionAmount: 2250,
        workerEarnings: 12750,
        currency: 'SYP',
        hourlyRate: null,
        minHours: null,
      };
      const booking = fakeBooking({
        status: BookingStatus.IN_PROGRESS,
        startedAt,
        pricing: fixedPricing,
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.complete(workerProfileId, bookingId);

      expect(booking.finalPricing).toEqual(fixedPricing);
    });
  });

  describe('cancellation fees', () => {
    it('charges no fee when the customer cancels more than the free-cancellation window before scheduledFor', async () => {
      const booking = fakeBooking({
        scheduledFor: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h out, policy free window is 24h
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByCustomer(customerId, bookingId, 'Change of plans');

      expect((booking.cancellation as Record<string, unknown>).feeAmount).toBe(0);
    });

    it('charges a fee when the customer cancels exactly at the free-cancellation boundary (not strictly more than)', async () => {
      const booking = fakeBooking({
        scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000), // exactly 24h out
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByCustomer(customerId, bookingId, 'Change of plans');

      // 20% of basePrice 6000 = 1200
      expect((booking.cancellation as Record<string, unknown>).feeAmount).toBe(1200);
    });

    it('charges a fee when the customer cancels inside the window', async () => {
      const booking = fakeBooking({
        scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h out
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByCustomer(customerId, bookingId, 'Running late forever');

      expect((booking.cancellation as Record<string, unknown>).feeAmount).toBe(1200);
    });

    it('never charges the customer a fee when the worker cancels after accepting', async () => {
      const booking = fakeBooking({ status: BookingStatus.ACCEPTED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByWorker(workerProfileId, 'worker-user-1', bookingId, 'Family emergency');

      const cancellation = booking.cancellation as Record<string, unknown>;
      expect(cancellation.feeAmount).toBe(0);
      expect(cancellation.byRole).toBe(Role.WORKER);
      expect(cancellation.byUserId).toBe('worker-user-1');
    });
  });

  describe('admin force-status', () => {
    it('forces CANCELLED, sets cancelledAt, and writes an audit log entry', async () => {
      const booking = fakeBooking({ status: BookingStatus.ACCEPTED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.forceStatus('admin-1', bookingId, {
        status: BookingStatus.CANCELLED,
        reason: 'Dispute resolved in customer favor',
      });

      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(booking.cancelledAt).toBeInstanceOf(Date);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: AuditAction.BOOKING_FORCE_CANCELLED,
          targetType: 'Booking',
          targetId: bookingId,
        }),
      );
    });

    it('forces NO_SHOW without setting cancelledAt, and writes the matching audit action', async () => {
      const booking = fakeBooking({ status: BookingStatus.IN_PROGRESS });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.forceStatus('admin-1', bookingId, {
        status: BookingStatus.NO_SHOW,
        reason: 'Worker never arrived, confirmed by both parties',
      });

      expect(booking.status).toBe(BookingStatus.NO_SHOW);
      expect(booking.cancelledAt).toBeNull();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.BOOKING_FORCE_NO_SHOW }),
      );
    });

    it('rejects forcing a transition that is not legal from the current status', async () => {
      const booking = fakeBooking({ status: BookingStatus.COMPLETED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await expect(
        service.forceStatus('admin-1', bookingId, {
          status: BookingStatus.CANCELLED,
          reason: 'Too late now',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });
});
