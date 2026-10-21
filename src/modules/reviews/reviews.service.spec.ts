import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { CountriesService } from '../countries/countries.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { ReviewsService } from './reviews.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('ReviewsService', () => {
  let service: ReviewsService;
  let reviewModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    aggregate: jest.Mock;
  };
  let bookingsService: { resolveOwnParty: jest.Mock };
  let workerProfilesService: { getOwn: jest.Mock; setRating: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };
  let auditLogService: { record: jest.Mock };

  const bookingId = 'booking-1';
  const customerId = 'customer-1';
  const workerUserId = 'worker-user-1';
  const workerProfileId = '507f1f77bcf86cd799439011';

  const country = { reviewPolicy: { reviewWindowDays: 14 } };

  function completedBooking(overrides: Record<string, unknown> = {}) {
    return {
      id: bookingId,
      status: BookingStatus.COMPLETED,
      customerId,
      workerProfileId,
      countryId: { toString: () => 'country-1' },
      completedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    reviewModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    bookingsService = { resolveOwnParty: jest.fn() };
    workerProfilesService = {
      getOwn: jest.fn().mockResolvedValue({ id: workerProfileId }),
      setRating: jest.fn().mockResolvedValue(undefined),
    };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(country) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new ReviewsService(
      reviewModel as never,
      bookingsService as unknown as BookingsService,
      workerProfilesService as unknown as WorkerProfilesService,
      countriesService as unknown as CountriesService,
      auditLogService as unknown as AuditLogService,
    );
  });

  describe('submit', () => {
    it('writes a CUSTOMER review keyed to the workerProfileId and recomputes the worker rating', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.CUSTOMER,
      });
      reviewModel.create.mockResolvedValue({ id: 'review-1' });

      await service.submit(customerId, bookingId, { rating: 5, comment: 'Great job' });

      expect(reviewModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          authorId: customerId,
          authorRole: Role.CUSTOMER,
          subjectId: workerProfileId,
          rating: 5,
          comment: 'Great job',
        }),
      );
      expect(workerProfilesService.setRating).toHaveBeenCalled();
    });

    it('writes a WORKER review keyed to the customerId, and does not touch the worker rating', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.WORKER,
      });
      reviewModel.create.mockResolvedValue({ id: 'review-2' });

      await service.submit(workerUserId, bookingId, { rating: 4 });

      expect(reviewModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ authorRole: Role.WORKER, subjectId: customerId }),
      );
      expect(workerProfilesService.setRating).not.toHaveBeenCalled();
    });

    it('rejects a non-COMPLETED booking', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking({ status: BookingStatus.IN_PROGRESS }),
        role: Role.CUSTOMER,
      });

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects once the review window has closed', async () => {
      const longAgo = new Date(Date.now() - 20 * 86_400_000);
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking({ completedAt: longAgo }),
        role: Role.CUSTOMER,
      });

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a duplicate review for the same direction as a conflict, not a raw duplicate-key error', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.CUSTOMER,
      });
      reviewModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        ConflictException,
      );
    });

    it("rejects a non-party, propagating resolveOwnParty's own NotFoundException", async () => {
      bookingsService.resolveOwnParty.mockRejectedValue(new NotFoundException());

      await expect(service.submit('stranger', bookingId, { rating: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getForBooking', () => {
    it("returns the caller's own review even when the other side hasn't submitted yet, with theirs null", async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.CUSTOMER,
      });
      reviewModel.findOne
        .mockReturnValueOnce(chainExec({ id: 'mine', authorRole: Role.CUSTOMER }))
        .mockReturnValueOnce(chainExec(null));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.mine).toEqual({ id: 'mine', authorRole: Role.CUSTOMER });
      expect(result.theirs).toBeNull();
    });

    it('reveals theirs once both sides have submitted', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.CUSTOMER,
      });
      reviewModel.findOne
        .mockReturnValueOnce(chainExec({ id: 'mine', authorRole: Role.CUSTOMER }))
        .mockReturnValueOnce(chainExec({ id: 'theirs', authorRole: Role.WORKER }));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.theirs).toEqual({ id: 'theirs', authorRole: Role.WORKER });
    });

    it('never reveals theirs — not even as a hidden-flagged object — before both submit or the window closes', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking(),
        role: Role.CUSTOMER,
      });
      reviewModel.findOne
        .mockReturnValueOnce(chainExec(null)) // I haven't submitted mine
        .mockReturnValueOnce(chainExec({ id: 'theirs', authorRole: Role.WORKER }));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.theirs).toBeNull();
      expect(Object.keys(result)).not.toContain('theirsHidden');
    });

    it('reveals theirs once the review window has closed, even if only one side ever submitted', async () => {
      const longAgo = new Date(Date.now() - 20 * 86_400_000);
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: completedBooking({ completedAt: longAgo }),
        role: Role.CUSTOMER,
      });
      reviewModel.findOne
        .mockReturnValueOnce(chainExec(null))
        .mockReturnValueOnce(chainExec({ id: 'theirs', authorRole: Role.WORKER }));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.theirs).toEqual({ id: 'theirs', authorRole: Role.WORKER });
    });
  });

  describe('hide', () => {
    it('hides a CUSTOMER-authored review, audit-logs it, and recomputes the worker rating', async () => {
      const review = {
        id: 'review-1',
        authorRole: Role.CUSTOMER,
        subjectId: { toString: () => workerProfileId },
        isHidden: false,
        save: jest.fn().mockResolvedValue(undefined),
      };
      reviewModel.findOne.mockReturnValue(chainExec(review));

      await service.hide('admin-1', 'review-1', { reason: { en: 'Spam' } });

      expect(review.isHidden).toBe(true);
      expect(review.save).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.REVIEW_HIDDEN, targetId: 'review-1' }),
      );
      expect(workerProfilesService.setRating).toHaveBeenCalled();
    });

    it('hides a WORKER-authored review without touching any worker rating', async () => {
      const review = {
        id: 'review-2',
        authorRole: Role.WORKER,
        subjectId: { toString: () => customerId },
        isHidden: false,
        save: jest.fn().mockResolvedValue(undefined),
      };
      reviewModel.findOne.mockReturnValue(chainExec(review));

      await service.hide('admin-1', 'review-2', { reason: { en: 'Spam' } });

      expect(workerProfilesService.setRating).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing review', async () => {
      reviewModel.findOne.mockReturnValue(chainExec(null));

      await expect(service.hide('admin-1', 'nope', { reason: { en: 'x' } })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recomputeWorkerRating', () => {
    it('recomputes from scratch (average of non-hidden reviews), never increments', async () => {
      reviewModel.aggregate.mockResolvedValue([{ average: 4.333333 }]);

      const rating = await service.recomputeWorkerRating(workerProfileId);

      expect(rating).toBe(4.3);
      expect(workerProfilesService.setRating).toHaveBeenCalledWith(workerProfileId, 4.3);
    });

    it('resets to 0 when there are no (non-hidden) reviews at all', async () => {
      reviewModel.aggregate.mockResolvedValue([]);

      const rating = await service.recomputeWorkerRating(workerProfileId);

      expect(rating).toBe(0);
      expect(workerProfilesService.setRating).toHaveBeenCalledWith(workerProfileId, 0);
    });
  });
});
