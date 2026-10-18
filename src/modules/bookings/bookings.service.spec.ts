import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingType } from '../../common/enums/booking-type.enum';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { NotificationEventType } from '../notifications/notification-event';
import { PricingService } from '../pricing/pricing.service';
import { ServicesService } from '../services/services.service';
import { UsersService } from '../users/users.service';
import { WorkerAvailabilityService } from '../workers/worker-availability.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { NearestAvailableAssignmentStrategy } from './assignment/nearest-available-assignment.strategy';
import { BookingsService } from './bookings.service';
import { InstantMatchingService } from './instant-matching.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { BookingOffer } from './schemas/booking-offer.schema';
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
    customerId: 'customer-1',
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
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
    countDocuments: jest.Mock;
    exists: jest.Mock;
  };
  let bookingOfferModel: { find: jest.Mock };
  let workerServicesService: {
    findActiveById: jest.Mock;
    findActiveByWorkerAndService: jest.Mock;
  };
  let workerProfilesService: {
    findApprovedById: jest.Mock;
    getForAdmin: jest.Mock;
    getOwn: jest.Mock;
  };
  let workerAvailabilityService: { getWindowsForDate: jest.Mock };
  let servicesService: { findActiveById: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };
  let pricingService: { quote: jest.Mock };
  let usersService: { findById: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let instantMatchingService: {
    startSearch: jest.Mock;
    markOutstandingOffersStale: jest.Mock;
    resolveOffers: jest.Mock;
  };
  let directAssignmentStrategy: { resolveWorker: jest.Mock };
  let nearestAvailableAssignmentStrategy: { resolveWorker: jest.Mock };
  let notifier: { notify: jest.Mock; notifyOffer: jest.Mock };

  const workerServiceId = 'worker-service-1';
  const cityId = 'city-1';
  const customerId = 'customer-1';
  const workerProfileId = 'worker-profile-1';

  const workerService = {
    _id: workerServiceId,
    id: workerServiceId,
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
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
      countDocuments: jest.fn(),
      exists: jest.fn(),
    };
    bookingOfferModel = { find: jest.fn() };
    workerServicesService = {
      findActiveById: jest.fn().mockResolvedValue(workerService),
      findActiveByWorkerAndService: jest.fn().mockResolvedValue(workerService),
    };
    workerProfilesService = {
      findApprovedById: jest.fn().mockResolvedValue(profile),
      getForAdmin: jest.fn().mockResolvedValue(profile),
      getOwn: jest.fn().mockResolvedValue(profile),
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
    usersService = {
      findById: jest.fn().mockResolvedValue({
        phone: '+963900000000',
        countryId: 'country-1',
        profile: { firstName: 'Layla' },
      }),
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    notifier = { notify: jest.fn().mockResolvedValue(undefined), notifyOffer: jest.fn() };
    instantMatchingService = {
      startSearch: jest.fn().mockResolvedValue(undefined),
      markOutstandingOffersStale: jest.fn().mockResolvedValue(undefined),
      resolveOffers: jest.fn().mockResolvedValue(undefined),
    };
    directAssignmentStrategy = {
      resolveWorker: jest.fn().mockResolvedValue({ workerProfileId }),
    };
    nearestAvailableAssignmentStrategy = {
      resolveWorker: jest.fn().mockResolvedValue({ workerProfileId: null }),
    };

    bookingModel.find.mockReturnValue(chainable([]));
    bookingModel.exists.mockResolvedValue(null);
    bookingModel.create.mockImplementation((doc) => Promise.resolve({ ...doc, id: 'new-booking' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(BookingOffer.name), useValue: bookingOfferModel },
        { provide: WorkerServicesService, useValue: workerServicesService },
        { provide: WorkerProfilesService, useValue: workerProfilesService },
        { provide: WorkerAvailabilityService, useValue: workerAvailabilityService },
        { provide: ServicesService, useValue: servicesService },
        { provide: CountriesService, useValue: countriesService },
        { provide: PricingService, useValue: pricingService },
        { provide: UsersService, useValue: usersService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: InstantMatchingService, useValue: instantMatchingService },
        { provide: DirectAssignmentStrategy, useValue: directAssignmentStrategy },
        {
          provide: NearestAvailableAssignmentStrategy,
          useValue: nearestAvailableAssignmentStrategy,
        },
        { provide: BOOKING_NOTIFIER, useValue: notifier },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  function validCreateDto(overrides: Record<string, unknown> = {}) {
    return {
      type: BookingType.SCHEDULED,
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

  function validInstantDto(overrides: Record<string, unknown> = {}) {
    return {
      type: BookingType.INSTANT,
      serviceId: 'service-1',
      cityId,
      estimatedDurationMinutes: 60,
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

  describe('create (INSTANT)', () => {
    it('creates a SEARCHING booking with no worker/workerService/pricing yet, and kicks off the search', async () => {
      const created = await service.create(customerId, validInstantDto());

      expect(bookingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId,
          workerProfileId: null,
          serviceId: 'service-1',
          workerServiceId: null,
          type: BookingType.INSTANT,
          status: BookingStatus.SEARCHING,
          scheduledFor: null,
          pricing: null,
          finalPricing: null,
          responseDeadline: null,
          pendingQuoteParams: { estimatedHours: 2, roomCount: null },
        }),
      );
      expect(instantMatchingService.startSearch).toHaveBeenCalledWith(created);
    });

    it('resolves her country from her own user record, not from any worker', async () => {
      await service.create(customerId, validInstantDto());
      expect(usersService.findById).toHaveBeenCalledWith(customerId);
      expect(countriesService.findActiveById).toHaveBeenCalledWith('country-1');
    });

    it('rejects when serviceId is missing', async () => {
      await expect(
        service.create(customerId, validInstantDto({ serviceId: undefined })),
      ).rejects.toThrow(BadRequestException);
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

  describe('isPartyToBooking', () => {
    function withSelect(resolvedValue: unknown) {
      bookingModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) }),
      });
    }

    it('returns false for a malformed id without ever querying', async () => {
      await expect(service.isPartyToBooking(customerId, 'not-an-id')).resolves.toBe(false);
      expect(bookingModel.findOne).not.toHaveBeenCalled();
    });

    it('returns false when the booking does not exist', async () => {
      withSelect(null);
      await expect(service.isPartyToBooking(customerId, bookingId)).resolves.toBe(false);
    });

    it("returns true for the booking's own customer", async () => {
      withSelect({ customerId: { toString: () => customerId }, workerProfileId: null });
      await expect(service.isPartyToBooking(customerId, bookingId)).resolves.toBe(true);
    });

    it('returns true for the assigned worker (resolved via her own WorkerProfile)', async () => {
      withSelect({
        customerId: { toString: () => 'someone-else' },
        workerProfileId: { toString: () => workerProfileId },
      });
      await expect(service.isPartyToBooking('worker-user-id', bookingId)).resolves.toBe(true);
      expect(workerProfilesService.findApprovedById).not.toHaveBeenCalled(); // uses getOwn, not the public-visibility gate
    });

    it('returns false for an unrelated user, including one with no worker profile at all', async () => {
      withSelect({
        customerId: { toString: () => 'someone-else' },
        workerProfileId: { toString: () => workerProfileId },
      });
      workerProfilesService.getOwn = jest.fn().mockRejectedValue(new NotFoundException());
      await expect(service.isPartyToBooking('a-random-user', bookingId)).resolves.toBe(false);
    });

    it('returns false when nobody has been assigned yet (SEARCHING) and the caller is not the customer', async () => {
      withSelect({ customerId: { toString: () => 'someone-else' }, workerProfileId: null });
      await expect(service.isPartyToBooking('some-worker-user', bookingId)).resolves.toBe(false);
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
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_ACCEPTED,
          recipientUserId: 'customer-1',
          bookingId,
          context: { workerDisplayName: 'Layla' },
        }),
      );
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

    it('onTheWay notifies the customer', async () => {
      const booking = fakeBooking({ status: BookingStatus.ACCEPTED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.onTheWay(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.ON_THE_WAY);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.WORKER_ON_THE_WAY,
          recipientUserId: 'customer-1',
          bookingId,
        }),
      );
    });

    it('arrived notifies the customer', async () => {
      const booking = fakeBooking({ status: BookingStatus.ON_THE_WAY });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.arrived(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.ARRIVED);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.WORKER_ARRIVED, bookingId }),
      );
    });

    it('start sets IN_PROGRESS and startedAt, and notifies the customer', async () => {
      const booking = fakeBooking({ status: BookingStatus.ARRIVED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.start(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.IN_PROGRESS);
      expect(booking.startedAt).toBeInstanceOf(Date);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.JOB_STARTED, bookingId }),
      );
    });

    it('complete recomputes finalPricing for HOURLY from actual elapsed time, using the frozen rate, and notifies the customer', async () => {
      const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
      const booking = fakeBooking({ status: BookingStatus.IN_PROGRESS, startedAt });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.complete(workerProfileId, bookingId);

      expect(booking.status).toBe(BookingStatus.COMPLETED);
      expect(booking.completedAt).toBeInstanceOf(Date);
      expect((booking.finalPricing as Record<string, unknown>).basePrice).toBe(9000); // 3000 * 3h
      expect((booking.finalPricing as Record<string, unknown>).hourlyRate).toBe(3000);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.JOB_COMPLETED, bookingId }),
      );
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

  describe('acceptOffer', () => {
    function searchingBooking(overrides: Record<string, unknown> = {}) {
      const booking: Record<string, unknown> = {
        _id: bookingId,
        id: bookingId,
        status: BookingStatus.ACCEPTED,
        workerProfileId,
        acceptedAt: new Date(),
        serviceId: { toString: () => 'service-1' },
        pendingQuoteParams: { estimatedHours: 2, roomCount: null },
        customerId: 'customer-1',
        ...overrides,
      };
      booking.save = jest.fn().mockResolvedValue(booking);
      return booking;
    }

    it('claims the booking via a single atomic findOneAndUpdate filtered on status SEARCHING and workerProfileId null — never read-then-write', async () => {
      const booking = searchingBooking();
      bookingModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.acceptOffer(workerProfileId, bookingId);

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: bookingId, status: BookingStatus.SEARCHING, workerProfileId: null },
        expect.objectContaining({ status: BookingStatus.ACCEPTED, workerProfileId }),
        { new: true },
      );
      expect(bookingModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects with a neutral 409 when another worker already won (the atomic update matched nothing)', async () => {
      bookingModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.acceptOffer(workerProfileId, bookingId)).rejects.toThrow(
        ConflictException,
      );
    });

    it("resolves pricing fresh against the winning worker's own offering, and marks every offer resolved", async () => {
      const booking = searchingBooking();
      bookingModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.acceptOffer(workerProfileId, bookingId);

      expect(workerServicesService.findActiveByWorkerAndService).toHaveBeenCalledWith(
        workerProfileId,
        'service-1',
      );
      expect(pricingService.quote).toHaveBeenCalledWith(workerServiceId, {
        estimatedHours: 2,
        roomCount: undefined,
      });
      expect(booking.pricing).toEqual(
        expect.objectContaining({ basePrice: 6000, workerEarnings: 5100 }),
      );
      expect(instantMatchingService.resolveOffers).toHaveBeenCalledWith(bookingId, workerProfileId);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_ACCEPTED,
          recipientUserId: 'customer-1',
          bookingId,
          context: { workerDisplayName: 'Layla' },
        }),
      );
    });

    it('fires N concurrent accept attempts at one booking and exactly one wins, with exactly one workerProfileId ending up on the booking', async () => {
      let claimed = false;
      let winningWorkerProfileId: string | null = null;

      // Simulates Mongo's real atomic findOneAndUpdate: only the first
      // caller whose filter still matches (status still SEARCHING) gets a
      // document back; every later caller — same tick or not — gets null,
      // exactly as a real unique "claim" update would under true concurrency.
      bookingModel.findOneAndUpdate.mockImplementation(
        (_filter: unknown, update: { workerProfileId: string }) => ({
          exec: jest.fn().mockImplementation(() => {
            if (claimed) {
              return Promise.resolve(null);
            }
            claimed = true;
            winningWorkerProfileId = update.workerProfileId;
            return Promise.resolve(searchingBooking({ workerProfileId: update.workerProfileId }));
          }),
        }),
      );

      const candidateWorkerIds = ['worker-a', 'worker-b', 'worker-c', 'worker-d', 'worker-e'];
      const results = await Promise.all(
        candidateWorkerIds.map((id) =>
          service
            .acceptOffer(id, bookingId)
            .then((booking) => ({
              outcome: 'won' as const,
              workerProfileId: booking.workerProfileId,
            }))
            .catch(() => ({ outcome: 'lost' as const, workerProfileId: null })),
        ),
      );

      const winners = results.filter((r) => r.outcome === 'won');
      const losers = results.filter((r) => r.outcome === 'lost');

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(4);
      expect(winningWorkerProfileId).not.toBeNull();
      expect(winners[0].workerProfileId).toBe(winningWorkerProfileId);
      expect(candidateWorkerIds).toContain(winningWorkerProfileId);
    });
  });

  describe('listPendingOffersForWorker', () => {
    it('returns [] when she has no pending offers', async () => {
      bookingOfferModel.find.mockReturnValue(chainable([]));
      await expect(service.listPendingOffersForWorker(workerProfileId)).resolves.toEqual([]);
    });

    it('projects each still-SEARCHING offer, skipping any whose booking already resolved (accepted/expired by the time she polls)', async () => {
      const offers = [
        {
          id: 'offer-1',
          bookingId: { toString: () => 'booking-1' },
          estimatedPrice: 8000,
          estimatedWorkerEarnings: 6800,
          currency: 'SYP',
          distanceMeters: 1200,
          sentAt: new Date(),
        },
        {
          id: 'offer-2',
          bookingId: { toString: () => 'booking-2' }, // no longer SEARCHING -> excluded from bookingModel.find below
          estimatedPrice: 5000,
          estimatedWorkerEarnings: 4000,
          currency: 'SYP',
          distanceMeters: 2000,
          sentAt: new Date(),
        },
      ];
      bookingOfferModel.find.mockReturnValue(chainable(offers));
      bookingModel.find.mockReturnValue(
        chainable([
          {
            id: 'booking-1',
            serviceId: { toString: () => 'service-1' },
            estimatedDurationMinutes: 60,
            cityId: { toString: () => cityId },
            address: { landmark: 'Blue mosque' },
          },
        ]),
      );

      const views = await service.listPendingOffersForWorker(workerProfileId);

      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        offerId: 'offer-1',
        estimatedPrice: 8000,
        landmark: 'Blue mosque',
      });
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

    it('never charges the customer a fee when the worker cancels after accepting, and notifies the customer', async () => {
      const booking = fakeBooking({ status: BookingStatus.ACCEPTED });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByWorker(workerProfileId, 'worker-user-1', bookingId, 'Family emergency');

      const cancellation = booking.cancellation as Record<string, unknown>;
      expect(cancellation.feeAmount).toBe(0);
      expect(cancellation.byRole).toBe(Role.WORKER);
      expect(cancellation.byUserId).toBe('worker-user-1');
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_CANCELLED,
          recipientUserId: 'customer-1',
          bookingId,
          context: { reason: 'Family emergency' },
        }),
      );
    });

    it('notifies the already-assigned worker when the customer cancels a committed booking', async () => {
      const booking = fakeBooking({
        status: BookingStatus.ACCEPTED,
        workerProfileId: { toString: () => workerProfileId },
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByCustomer(customerId, bookingId, 'Change of plans');

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_CANCELLED,
          recipientUserId: 'worker-user-1',
          bookingId,
        }),
      );
    });

    it('charges no fee when the customer cancels while SEARCHING (INSTANT, no worker ever committed) and stops the broadcast', async () => {
      const booking = fakeBooking({
        status: BookingStatus.SEARCHING,
        pricing: null,
        scheduledFor: null,
      });
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.cancelByCustomer(customerId, bookingId, 'Changed my mind');

      expect((booking.cancellation as Record<string, unknown>).feeAmount).toBe(0);
      // Never touches country policy — SEARCHING short-circuits before it's needed.
      expect(countriesService.findActiveById).not.toHaveBeenCalled();
      expect(instantMatchingService.markOutstandingOffersStale).toHaveBeenCalledWith(bookingId);
    });
  });

  describe('admin force-status', () => {
    it('forces CANCELLED, sets cancelledAt, writes an audit log entry, and notifies the customer and the assigned worker', async () => {
      const booking = fakeBooking({
        status: BookingStatus.ACCEPTED,
        workerProfileId: { toString: () => workerProfileId },
      });
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
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_CANCELLED,
          recipientUserId: 'customer-1',
          bookingId,
        }),
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.BOOKING_CANCELLED,
          recipientUserId: 'worker-user-1',
          bookingId,
        }),
      );
    });

    it('forces NO_SHOW without setting cancelledAt, writes the matching audit action, and sends no cancellation notification', async () => {
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
      expect(notifier.notify).not.toHaveBeenCalled();
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
