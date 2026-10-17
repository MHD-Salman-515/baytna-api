import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { CountriesService } from '../countries/countries.service';
import { PricingService } from '../pricing/pricing.service';
import { WorkerPresenceService } from '../workers/worker-presence.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { InstantMatchingService } from './instant-matching.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { BookingOffer, BookingOfferOutcome } from './schemas/booking-offer.schema';
import { Booking } from './schemas/booking.schema';

function chainableExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('InstantMatchingService', () => {
  let service: InstantMatchingService;
  let bookingModel: { distinct: jest.Mock };
  let offerModel: {
    distinct: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
  };
  let workerPresenceService: { findEligibleCandidates: jest.Mock };
  let workerServicesService: { findActiveByWorkerAndService: jest.Mock };
  let pricingService: { quote: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };
  let notifier: { notifyOffer: jest.Mock };

  const country = {
    instantMatchingPolicy: {
      radiusStepsMeters: [3000, 6000, 10000],
      waveTimeoutSeconds: 20,
      totalRequestTimeoutSeconds: 90,
      heartbeatStalenessSeconds: 120,
    },
  };

  const booking: Record<string, unknown> = {
    _id: 'booking-1',
    id: 'booking-1',
    countryId: { toString: () => 'country-1' },
    serviceId: { toString: () => 'service-1' },
    cityId: { toString: () => 'city-1' },
    address: { point: { type: 'Point', coordinates: [36.3, 33.5] } },
    pendingQuoteParams: { estimatedHours: 2, roomCount: null },
    instantMatching: null,
    save: jest.fn(),
  };

  beforeEach(async () => {
    booking.save = jest.fn().mockResolvedValue(booking);
    booking.instantMatching = null;

    bookingModel = { distinct: jest.fn().mockReturnValue(chainableExec([])) };
    offerModel = {
      distinct: jest.fn().mockReturnValue(chainableExec([])),
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockReturnValue(chainableExec({})),
      updateMany: jest.fn().mockReturnValue(chainableExec({})),
    };
    workerPresenceService = { findEligibleCandidates: jest.fn().mockResolvedValue([]) };
    workerServicesService = {
      findActiveByWorkerAndService: jest.fn().mockResolvedValue({ id: 'worker-service-1' }),
    };
    pricingService = {
      quote: jest.fn().mockResolvedValue({
        basePrice: 8000,
        workerEarnings: 6800,
        currency: 'SYP',
        breakdown: { pricingType: PricingType.HOURLY },
      }),
    };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(country) };
    notifier = { notifyOffer: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstantMatchingService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(BookingOffer.name), useValue: offerModel },
        { provide: WorkerPresenceService, useValue: workerPresenceService },
        { provide: WorkerServicesService, useValue: workerServicesService },
        { provide: PricingService, useValue: pricingService },
        { provide: CountriesService, useValue: countriesService },
        { provide: BOOKING_NOTIFIER, useValue: notifier },
      ],
    }).compile();

    service = module.get(InstantMatchingService);
  });

  describe('startSearch', () => {
    it('sets instantMatching state at wave 0 and broadcasts', async () => {
      await service.startSearch(booking as never);

      expect((booking.instantMatching as Record<string, unknown>).currentWaveIndex).toBe(0);
      expect(booking.save).toHaveBeenCalled();
      // broadcastWave ran -> it always checks for already-notified workers first.
      expect(offerModel.distinct).toHaveBeenCalledWith('workerProfileId', {
        bookingId: booking._id,
      });
    });
  });

  describe('broadcastWave', () => {
    it('does nothing further when there are no eligible candidates', async () => {
      workerPresenceService.findEligibleCandidates.mockResolvedValue([]);
      await service.broadcastWave(booking as never, 0);
      expect(bookingModel.distinct).not.toHaveBeenCalled();
      expect(offerModel.create).not.toHaveBeenCalled();
    });

    it('queries eligibility with the wave radius, staleness window, and the already-notified exclude list', async () => {
      offerModel.distinct.mockReturnValue(chainableExec(['already-notified-1']));
      workerPresenceService.findEligibleCandidates.mockResolvedValue([]);

      await service.broadcastWave(booking as never, 1); // wave index 1 -> 6000m

      expect(workerPresenceService.findEligibleCandidates).toHaveBeenCalledWith({
        serviceId: 'service-1',
        cityId: 'city-1',
        point: (booking.address as { point: unknown }).point,
        radiusMeters: 6000,
        staleAfterSeconds: 120,
        excludeWorkerProfileIds: ['already-notified-1'],
      });
    });

    it('excludes a candidate who already has an active (busy) booking, without creating an offer for her', async () => {
      workerPresenceService.findEligibleCandidates.mockResolvedValue([
        { workerProfileId: 'worker-busy', distanceMeters: 1000 },
        { workerProfileId: 'worker-free', distanceMeters: 2000 },
      ]);
      bookingModel.distinct.mockReturnValue(chainableExec(['worker-busy']));

      await service.broadcastWave(booking as never, 0);

      expect(offerModel.create).toHaveBeenCalledTimes(1);
      expect(offerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerProfileId: 'worker-free' }),
      );
    });

    it('creates an offer with a fresh per-candidate price preview and notifies her', async () => {
      workerPresenceService.findEligibleCandidates.mockResolvedValue([
        { workerProfileId: 'worker-free', distanceMeters: 1500 },
      ]);

      await service.broadcastWave(booking as never, 0);

      expect(workerServicesService.findActiveByWorkerAndService).toHaveBeenCalledWith(
        'worker-free',
        'service-1',
      );
      expect(offerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: booking._id,
          workerProfileId: 'worker-free',
          workerServiceId: 'worker-service-1',
          wave: 0,
          radiusMeters: 3000,
          distanceMeters: 1500,
          estimatedPrice: 8000,
          estimatedWorkerEarnings: 6800,
          currency: 'SYP',
          outcome: BookingOfferOutcome.PENDING,
        }),
      );
      expect(notifier.notifyOffer).toHaveBeenCalledWith({
        workerProfileId: 'worker-free',
        bookingId: 'booking-1',
        wave: 0,
        radiusMeters: 3000,
      });
    });

    it('skips (does not throw) when offer creation hits the unique-index race (code 11000)', async () => {
      workerPresenceService.findEligibleCandidates.mockResolvedValue([
        { workerProfileId: 'worker-free', distanceMeters: 1500 },
      ]);
      offerModel.create.mockRejectedValue({ code: 11000 });

      await expect(service.broadcastWave(booking as never, 0)).resolves.toBeUndefined();
      expect(notifier.notifyOffer).not.toHaveBeenCalled();
    });

    it('propagates a non-duplicate-key error', async () => {
      workerPresenceService.findEligibleCandidates.mockResolvedValue([
        { workerProfileId: 'worker-free', distanceMeters: 1500 },
      ]);
      offerModel.create.mockRejectedValue(new Error('boom'));

      await expect(service.broadcastWave(booking as never, 0)).rejects.toThrow('boom');
    });
  });

  describe('markOutstandingOffersStale', () => {
    it('flips every PENDING offer for the booking to STALE, casting bookingId to match how it was stored', async () => {
      const bookingId = new Types.ObjectId().toString();
      await service.markOutstandingOffersStale(bookingId);
      expect(offerModel.updateMany).toHaveBeenCalledWith(
        { bookingId: new Types.ObjectId(bookingId), outcome: BookingOfferOutcome.PENDING },
        expect.objectContaining({ outcome: BookingOfferOutcome.STALE }),
      );
    });
  });

  describe('resolveOffers', () => {
    it('marks the winner WON and every other still-PENDING offer LOST, casting bookingId to match how it was stored', async () => {
      const bookingId = new Types.ObjectId().toString();
      await service.resolveOffers(bookingId, 'worker-winner');

      expect(offerModel.updateOne).toHaveBeenCalledWith(
        { bookingId: new Types.ObjectId(bookingId), workerProfileId: 'worker-winner' },
        expect.objectContaining({ outcome: BookingOfferOutcome.WON }),
      );
      expect(offerModel.updateMany).toHaveBeenCalledWith(
        {
          bookingId: new Types.ObjectId(bookingId),
          workerProfileId: { $ne: 'worker-winner' },
          outcome: BookingOfferOutcome.PENDING,
        },
        expect.objectContaining({ outcome: BookingOfferOutcome.LOST }),
      );
    });
  });
});
