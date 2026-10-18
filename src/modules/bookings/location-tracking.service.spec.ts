import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { LocationTrackingService } from './location-tracking.service';
import { BookingLocationTrail } from './schemas/booking-location-trail.schema';
import { Booking } from './schemas/booking.schema';

function point(lon: number, lat: number) {
  return { type: 'Point' as const, coordinates: [lon, lat] as [number, number] };
}

function chainableSelect(resolvedValue: unknown) {
  return {
    select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) }),
  };
}

describe('LocationTrackingService', () => {
  let service: LocationTrackingService;
  let trailModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
  let bookingModel: { findOne: jest.Mock };
  let configService: { get: jest.Mock };

  const bookingId = '507f1f77bcf86cd799439011';
  const workerProfileId = 'worker-profile-1';

  beforeEach(async () => {
    trailModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    bookingModel = { findOne: jest.fn() };
    configService = {
      get: jest.fn().mockImplementation((_key: string, fallback?: unknown) => fallback),
    };
    trailModel.findOne.mockReturnValue(chainableSelect(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationTrackingService,
        { provide: getModelToken(BookingLocationTrail.name), useValue: trailModel },
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(LocationTrackingService);
  });

  describe('recordPoint', () => {
    it('rejects a malformed booking id without ever querying', async () => {
      const result = await service.recordPoint(workerProfileId, 'not-an-id', point(36.3, 33.5));

      expect(result).toEqual({ accepted: false, reason: 'not_found' });
      expect(bookingModel.findOne).not.toHaveBeenCalled();
    });

    it("rejects when the booking isn't hers (or doesn't exist)", async () => {
      bookingModel.findOne.mockReturnValue(chainableSelect(null));

      const result = await service.recordPoint(
        workerProfileId,
        '507f1f77bcf86cd799439011',
        point(36.3, 33.5),
      );

      expect(result).toEqual({ accepted: false, reason: 'not_found' });
    });

    it.each([
      BookingStatus.PENDING_WORKER,
      BookingStatus.ACCEPTED,
      BookingStatus.SEARCHING,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
      BookingStatus.REJECTED,
      BookingStatus.EXPIRED,
      BookingStatus.NO_WORKER_FOUND,
      BookingStatus.NO_SHOW,
    ])('rejects a location update while the booking is %s', async (status) => {
      bookingModel.findOne.mockReturnValue(chainableSelect({ status }));

      const result = await service.recordPoint(workerProfileId, bookingId, point(36.3, 33.5));

      expect(result).toEqual({ accepted: false, reason: 'not_active' });
      expect(trailModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([BookingStatus.ON_THE_WAY, BookingStatus.ARRIVED, BookingStatus.IN_PROGRESS])(
      'accepts a location update while the booking is %s',
      async (status) => {
        bookingModel.findOne.mockReturnValue(chainableSelect({ status }));

        const result = await service.recordPoint(workerProfileId, bookingId, point(36.3, 33.5));

        expect(result).toEqual({ accepted: true });
        expect(trailModel.findOneAndUpdate).toHaveBeenCalled();
      },
    );

    it('rejects an update that arrives before the configured minimum interval has elapsed', async () => {
      bookingModel.findOne.mockReturnValue(chainableSelect({ status: BookingStatus.ON_THE_WAY }));
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.updateMinIntervalSeconds' ? 5 : fallback,
      );
      trailModel.findOne.mockReturnValue(chainableSelect({ lastRecordedAt: new Date() }));

      const result = await service.recordPoint(workerProfileId, bookingId, point(36.3, 33.5));

      expect(result).toEqual({ accepted: false, reason: 'throttled' });
      expect(trailModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('accepts an update once the minimum interval has elapsed', async () => {
      bookingModel.findOne.mockReturnValue(chainableSelect({ status: BookingStatus.ON_THE_WAY }));
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.updateMinIntervalSeconds' ? 5 : fallback,
      );
      trailModel.findOne.mockReturnValue(
        chainableSelect({ lastRecordedAt: new Date(Date.now() - 10_000) }),
      );

      const result = await service.recordPoint(workerProfileId, bookingId, point(36.3, 33.5));

      expect(result).toEqual({ accepted: true });
    });

    it('caps the trail via $slice at the configured max points', async () => {
      bookingModel.findOne.mockReturnValue(chainableSelect({ status: BookingStatus.ON_THE_WAY }));
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.trailMaxPoints' ? 50 : fallback,
      );

      await service.recordPoint(workerProfileId, bookingId, point(36.3, 33.5));

      expect(trailModel.findOneAndUpdate).toHaveBeenCalledWith(
        { bookingId },
        expect.objectContaining({
          $push: expect.objectContaining({
            points: expect.objectContaining({ $slice: -50 }),
          }),
        }),
        { upsert: true },
      );
    });
  });

  describe('recordArrivalDistance', () => {
    it('stores the distance between the last reported point and the booking address', async () => {
      trailModel.findOne.mockReturnValue(
        chainableSelect({ points: [{ point: point(36.3, 33.5), recordedAt: new Date() }] }),
      );

      await service.recordArrivalDistance(bookingId, point(36.301, 33.501));

      expect(trailModel.updateOne).toHaveBeenCalledWith(
        { bookingId },
        { arrivalDistanceMeters: expect.any(Number) },
      );
    });

    it('is a no-op when nothing was ever reported', async () => {
      trailModel.findOne.mockReturnValue(chainableSelect(null));

      await service.recordArrivalDistance(bookingId, point(36.3, 33.5));

      expect(trailModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentPosition', () => {
    it("returns the worker's last position with a rough ETA", async () => {
      const recordedAt = new Date();
      trailModel.findOne.mockReturnValue(
        chainableSelect({ points: [{ point: point(36.3, 33.5), recordedAt }] }),
      );

      const result = await service.getCurrentPosition(bookingId, point(36.301, 33.501));

      expect(result.point).toEqual(point(36.3, 33.5));
      expect(result.recordedAt).toBe(recordedAt);
      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(result.etaMinutes).toBeGreaterThanOrEqual(0);
    });

    it('throws NotFoundException when nothing has ever been reported', async () => {
      trailModel.findOne.mockReturnValue(chainableSelect(null));

      await expect(service.getCurrentPosition(bookingId, point(36.3, 33.5))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markTerminated', () => {
    it('sets terminatedAt', async () => {
      await service.markTerminated(bookingId);
      expect(trailModel.updateOne).toHaveBeenCalledWith(
        { bookingId },
        { terminatedAt: expect.any(Date) },
      );
    });
  });
});
