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
  let bookingsService: { getOwnForCustomer: jest.Mock; getOwnForWorker: jest.Mock };
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
    bookingsService = {
      getOwnForCustomer: jest.fn(),
      getOwnForWorker: jest.fn(),
    };
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
      bookingsService.getOwnForCustomer.mockResolvedValue(completedBooking());
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

    it('writes a WORKER review keyed to the customerId, resolved via her own worker profile, and does not touch the worker rating', async () => {
      bookingsService.getOwnForCustomer.mockRejectedValue(new NotFoundException());
      bookingsService.getOwnForWorker.mockResolvedValue(completedBooking());
      reviewModel.create.mockResolvedValue({ id: 'review-2' });

      await service.submit(workerUserId, bookingId, { rating: 4 });

      expect(workerProfilesService.getOwn).toHaveBeenCalledWith(workerUserId);
      expect(bookingsService.getOwnForWorker).toHaveBeenCalledWith(workerProfileId, bookingId);
      expect(reviewModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ authorRole: Role.WORKER, subjectId: customerId }),
      );
      expect(workerProfilesService.setRating).not.toHaveBeenCalled();
    });

    it('rejects a non-COMPLETED booking', async () => {
      bookingsService.getOwnForCustomer.mockResolvedValue(
        completedBooking({ status: BookingStatus.IN_PROGRESS }),
      );

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects once the review window has closed', async () => {
      const longAgo = new Date(Date.now() - 20 * 86_400_000);
      bookingsService.getOwnForCustomer.mockResolvedValue(
        completedBooking({ completedAt: longAgo }),
      );

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a duplicate review for the same direction as a conflict, not a raw duplicate-key error', async () => {
      bookingsService.getOwnForCustomer.mockResolvedValue(completedBooking());
      reviewModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

      await expect(service.submit(customerId, bookingId, { rating: 5 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a non-party (neither the customer nor resolvable as the worker)', async () => {
      bookingsService.getOwnForCustomer.mockRejectedValue(new NotFoundException());
      workerProfilesService.getOwn.mockRejectedValue(new NotFoundException());

      await expect(service.submit('stranger', bookingId, { rating: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getForBooking', () => {
    it("returns the caller's own review even when the other side hasn't submitted yet, with theirs null", async () => {
      bookingsService.getOwnForCustomer.mockResolvedValue(completedBooking());
      reviewModel.findOne
        .mockReturnValueOnce(chainExec({ id: 'mine', authorRole: Role.CUSTOMER }))
        .mockReturnValueOnce(chainExec(null));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.mine).toEqual({ id: 'mine', authorRole: Role.CUSTOMER });
      expect(result.theirs).toBeNull();
    });

    it('reveals theirs once both sides have submitted', async () => {
      bookingsService.getOwnForCustomer.mockResolvedValue(completedBooking());
      reviewModel.findOne
        .mockReturnValueOnce(chainExec({ id: 'mine', authorRole: Role.CUSTOMER }))
        .mockReturnValueOnce(chainExec({ id: 'theirs', authorRole: Role.WORKER }));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.theirs).toEqual({ id: 'theirs', authorRole: Role.WORKER });
    });

    it('never reveals theirs — not even as a hidden-flagged object — before both submit or the window closes', async () => {
      bookingsService.getOwnForCustomer.mockResolvedValue(completedBooking());
      reviewModel.findOne
        .mockReturnValueOnce(chainExec(null)) // I haven't submitted mine
        .mockReturnValueOnce(chainExec({ id: 'theirs', authorRole: Role.WORKER }));

      const result = await service.getForBooking(customerId, bookingId);

      expect(result.theirs).toBeNull();
      expect(Object.keys(result)).not.toContain('theirsHidden');
    });

    it('reveals theirs once the review window has closed, even if only one side ever submitted', async () => {
      const longAgo = new Date(Date.now() - 20 * 86_400_000);
      bookingsService.getOwnForCustomer.mockResolvedValue(
        completedBooking({ completedAt: longAgo }),
      );
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
