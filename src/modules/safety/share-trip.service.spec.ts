import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Role } from '../../common/enums/role.enum';
import { BookingsService } from '../bookings/bookings.service';
import { LocationTrackingService } from '../bookings/location-tracking.service';
import { UsersService } from '../users/users.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { ShareTripService } from './share-trip.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('ShareTripService', () => {
  let service: ShareTripService;
  let tokenModel: { create: jest.Mock; findOne: jest.Mock; updateMany: jest.Mock };
  let bookingsService: { resolveOwnParty: jest.Mock; getForAdmin: jest.Mock };
  let locationTrackingService: { getCurrentPosition: jest.Mock };
  let workerProfilesService: { getForAdmin: jest.Mock };
  let usersService: { findById: jest.Mock };
  let configService: { get: jest.Mock };

  const bookingId = 'booking-1';
  const token = 'a'.repeat(64);

  function activeBooking(overrides: Record<string, unknown> = {}) {
    return {
      status: BookingStatus.ON_THE_WAY,
      workerProfileId: { toString: () => 'worker-profile-1' },
      address: { point: { type: 'Point', coordinates: [36.3, 33.5] } },
      completedAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
      // Fields that must NEVER reach the public response.
      customerId: 'customer-1',
      customerPhone: '+963900000000',
      ...overrides,
    };
  }

  beforeEach(() => {
    tokenModel = { create: jest.fn(), findOne: jest.fn(), updateMany: jest.fn() };
    bookingsService = { resolveOwnParty: jest.fn(), getForAdmin: jest.fn() };
    locationTrackingService = { getCurrentPosition: jest.fn() };
    workerProfilesService = {
      getForAdmin: jest.fn().mockResolvedValue({ userId: { toString: () => 'worker-user-1' } }),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ profile: { firstName: 'Layla' } }),
    };
    configService = { get: jest.fn().mockReturnValue(60) };

    tokenModel.updateMany.mockReturnValue(chainExec({}));

    service = new ShareTripService(
      tokenModel as never,
      bookingsService as unknown as BookingsService,
      locationTrackingService as unknown as LocationTrackingService,
      workerProfilesService as unknown as WorkerProfilesService,
      usersService as unknown as UsersService,
      configService as unknown as ConfigService,
    );
  });

  describe('createForBooking', () => {
    it('verifies the caller is a party before minting an opaque token', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({ booking: {}, role: Role.CUSTOMER });
      tokenModel.create.mockResolvedValue({ id: 'token-row-1', token: 'minted' });

      await service.createForBooking('customer-1', bookingId);

      expect(bookingsService.resolveOwnParty).toHaveBeenCalledWith('customer-1', bookingId);
      const [args] = tokenModel.create.mock.calls[0] as [{ token: string }];
      expect(args.token).toHaveLength(64); // 32 bytes hex-encoded
      expect(args).toMatchObject({
        bookingId,
        createdByUserId: 'customer-1',
        createdByRole: Role.CUSTOMER,
      });
    });

    it('propagates a non-party rejection without ever minting a token', async () => {
      bookingsService.resolveOwnParty.mockRejectedValue(new NotFoundException());

      await expect(service.createForBooking('stranger', bookingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(tokenModel.create).not.toHaveBeenCalled();
    });
  });

  describe('revokeForBooking', () => {
    it('verifies party before revoking every active token for the booking', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({ booking: {}, role: Role.CUSTOMER });

      await service.revokeForBooking('customer-1', bookingId);

      expect(tokenModel.updateMany).toHaveBeenCalledWith(
        { bookingId, revokedAt: null },
        expect.objectContaining({ revokedAt: expect.any(Date), revokedBy: 'customer-1' }),
      );
    });
  });

  describe('getPublicView', () => {
    it('throws NotFoundException for a token that does not exist', async () => {
      tokenModel.findOne.mockReturnValue(chainExec(null));

      await expect(service.getPublicView(token)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a revoked token — identical to not-found', async () => {
      tokenModel.findOne.mockReturnValue(
        chainExec({ bookingId: { toString: () => bookingId }, revokedAt: new Date() }),
      );

      await expect(service.getPublicView(token)).rejects.toThrow(NotFoundException);
    });

    it('returns live position/ETA for an active booking, and only the allowlisted keys', async () => {
      tokenModel.findOne.mockReturnValue(
        chainExec({ bookingId: { toString: () => bookingId }, revokedAt: null }),
      );
      bookingsService.getForAdmin.mockResolvedValue(activeBooking());
      locationTrackingService.getCurrentPosition.mockResolvedValue({
        point: { type: 'Point', coordinates: [36.31, 33.51] },
        recordedAt: new Date(),
        distanceMeters: 500,
        etaMinutes: 4,
      });

      const view = await service.getPublicView(token);

      expect(Object.keys(view).sort()).toEqual(
        ['etaMinutes', 'position', 'status', 'workerFirstName'].sort(),
      );
      expect(view.workerFirstName).toBe('Layla');
      expect(view.status).toBe(BookingStatus.ON_THE_WAY);
      expect(view.etaMinutes).toBe(4);
      expect(JSON.stringify(view)).not.toContain('customer-1');
      expect(JSON.stringify(view)).not.toContain('+963900000000');
    });

    it('returns null position/eta (but still the status) once the booking is terminal but within the grace period', async () => {
      tokenModel.findOne.mockReturnValue(
        chainExec({ bookingId: { toString: () => bookingId }, revokedAt: null }),
      );
      bookingsService.getForAdmin.mockResolvedValue(
        activeBooking({ status: BookingStatus.COMPLETED, completedAt: new Date() }),
      );

      const view = await service.getPublicView(token);

      expect(view.status).toBe(BookingStatus.COMPLETED);
      expect(view.position).toBeNull();
      expect(view.etaMinutes).toBeNull();
      expect(locationTrackingService.getCurrentPosition).not.toHaveBeenCalled();
    });

    it('expires once the booking has been terminal for longer than the grace period', async () => {
      tokenModel.findOne.mockReturnValue(
        chainExec({ bookingId: { toString: () => bookingId }, revokedAt: null }),
      );
      const longAgo = new Date(Date.now() - 2 * 3_600_000); // 2h ago, grace period is 60min
      bookingsService.getForAdmin.mockResolvedValue(
        activeBooking({ status: BookingStatus.COMPLETED, completedAt: longAgo }),
      );

      await expect(service.getPublicView(token)).rejects.toThrow(NotFoundException);
    });

    it('never throws when no location has been reported yet — position is simply null', async () => {
      tokenModel.findOne.mockReturnValue(
        chainExec({ bookingId: { toString: () => bookingId }, revokedAt: null }),
      );
      bookingsService.getForAdmin.mockResolvedValue(activeBooking());
      locationTrackingService.getCurrentPosition.mockRejectedValue(new NotFoundException());

      const view = await service.getPublicView(token);

      expect(view.position).toBeNull();
      expect(view.etaMinutes).toBeNull();
    });
  });
});
