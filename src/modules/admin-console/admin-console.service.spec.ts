import { Role } from '../../common/enums/role.enum';
import { BookingsService } from '../bookings/bookings.service';
import { PanicAlertsService } from '../safety/panic-alerts.service';
import { PanicAlertStatus } from '../safety/schemas/panic-alert.schema';
import { ReportsService } from '../reports/reports.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WorkerDocumentsService } from '../workers/worker-documents.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { VerificationStatus } from '../workers/schemas/worker-profile.schema';
import { AdminConsoleService } from './admin-console.service';

function paginated(data: unknown[], total: number) {
  return { data, meta: { page: 1, limit: 20, total, totalPages: 1 } };
}

describe('AdminConsoleService', () => {
  let service: AdminConsoleService;
  let bookingsService: {
    getStatusCountsSince: jest.Mock;
    getInstantMatchingFailureRate: jest.Mock;
    getOperationalMetrics: jest.Mock;
    searchByBookingNumberPrefix: jest.Mock;
    projectForAdmin: jest.Mock;
    listForAdmin: jest.Mock;
  };
  let workerProfilesService: {
    listForAdmin: jest.Mock;
    getForAdmin: jest.Mock;
    getForAdminWithUser: jest.Mock;
    getOwn: jest.Mock;
    getAverageRating: jest.Mock;
  };
  let workerDocumentsService: { listForAdmin: jest.Mock };
  let workerServicesService: { listForAdmin: jest.Mock };
  let reviewsService: { listForAdmin: jest.Mock };
  let walletsService: { listForAdmin: jest.Mock; getForAdmin: jest.Mock };
  let reportsService: { listForAdmin: jest.Mock };
  let panicAlertsService: { listForAdmin: jest.Mock };
  let usersService: { searchByPhoneOrName: jest.Mock };

  beforeEach(() => {
    bookingsService = {
      getStatusCountsSince: jest.fn().mockResolvedValue({}),
      getInstantMatchingFailureRate: jest.fn().mockResolvedValue({
        totalInstant: 0,
        noWorkerFound: 0,
        ratePercent: 0,
      }),
      getOperationalMetrics: jest.fn().mockResolvedValue({}),
      searchByBookingNumberPrefix: jest.fn().mockResolvedValue([]),
      projectForAdmin: jest.fn().mockImplementation((b) => Promise.resolve(b)),
      listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)),
    };
    workerProfilesService = {
      listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)),
      getForAdmin: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      getForAdminWithUser: jest.fn().mockResolvedValue({ id: 'profile-1', name: 'Jane Worker' }),
      getOwn: jest.fn(),
      getAverageRating: jest.fn().mockResolvedValue(4.2),
    };
    workerDocumentsService = { listForAdmin: jest.fn().mockResolvedValue([]) };
    workerServicesService = { listForAdmin: jest.fn().mockResolvedValue([]) };
    reviewsService = { listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)) };
    walletsService = {
      listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)),
      getForAdmin: jest.fn().mockResolvedValue({ balance: 1000 }),
    };
    reportsService = { listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)) };
    panicAlertsService = { listForAdmin: jest.fn().mockResolvedValue(paginated([], 0)) };
    usersService = { searchByPhoneOrName: jest.fn().mockResolvedValue([]) };

    service = new AdminConsoleService(
      bookingsService as unknown as BookingsService,
      workerProfilesService as unknown as WorkerProfilesService,
      workerDocumentsService as unknown as WorkerDocumentsService,
      workerServicesService as unknown as WorkerServicesService,
      reviewsService as unknown as ReviewsService,
      walletsService as unknown as WalletsService,
      reportsService as unknown as ReportsService,
      panicAlertsService as unknown as PanicAlertsService,
      usersService as unknown as UsersService,
    );
  });

  describe('getDashboard', () => {
    it('combines every count via the existing admin-facing methods, never a raw model', async () => {
      bookingsService.getStatusCountsSince.mockResolvedValue({ COMPLETED: 3 });
      workerProfilesService.listForAdmin.mockResolvedValue(paginated([], 4));
      reportsService.listForAdmin
        .mockResolvedValueOnce(paginated([], 2)) // OPEN
        .mockResolvedValueOnce(paginated([], 1)); // INVESTIGATING
      panicAlertsService.listForAdmin.mockResolvedValue(paginated([], 1));
      walletsService.listForAdmin.mockResolvedValue(paginated([], 5));

      const dashboard = await service.getDashboard();

      expect(workerProfilesService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: VerificationStatus.PENDING_REVIEW }),
      );
      expect(walletsService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ lowBalance: true }),
      );
      expect(panicAlertsService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: PanicAlertStatus.OPEN }),
      );
      expect(dashboard.pendingVerifications).toBe(4);
      expect(dashboard.openReports).toBe(3); // 2 OPEN + 1 INVESTIGATING, summed
      expect(dashboard.unresolvedPanicAlerts).toBe(1);
      expect(dashboard.workersBelowLowBalanceThreshold).toBe(5);
    });
  });

  describe('search', () => {
    it('resolves a matched WORKER-role user into her worker-profile summary', async () => {
      usersService.searchByPhoneOrName.mockResolvedValue([
        {
          id: 'user-1',
          phone: '+963900000000',
          roles: [Role.CUSTOMER, Role.WORKER],
          status: 'ACTIVE',
          profile: {},
        },
      ]);
      workerProfilesService.getOwn.mockResolvedValue({
        id: 'profile-1',
        verificationStatus: 'APPROVED',
        financialStatus: 'ACTIVE',
        rating: 4.5,
      });

      const result = await service.search({ phone: '0900000000' });

      expect(result.users).toHaveLength(1);
      expect(result.workers).toEqual([
        {
          workerProfileId: 'profile-1',
          userId: 'user-1',
          phone: '+963900000000',
          verificationStatus: 'APPROVED',
          financialStatus: 'ACTIVE',
          rating: 4.5,
        },
      ]);
    });

    it('silently drops a WORKER-role user whose profile lookup fails', async () => {
      usersService.searchByPhoneOrName.mockResolvedValue([
        {
          id: 'user-1',
          phone: '+963900000000',
          roles: [Role.WORKER],
          status: 'ACTIVE',
          profile: {},
        },
      ]);
      workerProfilesService.getOwn.mockRejectedValue(new Error('not found'));

      const result = await service.search({ name: 'Layla' });

      expect(result.workers).toEqual([]);
    });

    it('runs no user search at all when neither phone nor name is given', async () => {
      await service.search({ bookingNumber: 'BK-X' });

      expect(usersService.searchByPhoneOrName).not.toHaveBeenCalled();
    });

    it('projects matched bookings through the existing admin projection', async () => {
      bookingsService.searchByBookingNumberPrefix.mockResolvedValue([{ id: 'booking-1' }]);

      const result = await service.search({ bookingNumber: 'BK-X' });

      expect(bookingsService.projectForAdmin).toHaveBeenCalledWith({ id: 'booking-1' });
      expect(result.bookings).toEqual([{ id: 'booking-1' }]);
    });
  });

  describe('getWorker360', () => {
    it('pulls together every sub-resource via the existing admin-facing service methods', async () => {
      await service.getWorker360('profile-1');

      expect(workerProfilesService.getForAdminWithUser).toHaveBeenCalledWith('profile-1');
      expect(workerDocumentsService.listForAdmin).toHaveBeenCalledWith('profile-1');
      expect(workerServicesService.listForAdmin).toHaveBeenCalledWith('profile-1');
      expect(bookingsService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ workerProfileId: 'profile-1' }),
      );
      expect(reviewsService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ subjectId: 'profile-1' }),
      );
      expect(walletsService.getForAdmin).toHaveBeenCalledWith('profile-1');
      expect(reportsService.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ subjectId: 'profile-1' }),
      );
    });
  });

  describe('getMetrics', () => {
    it('combines booking operational metrics with the platform-wide average rating', async () => {
      bookingsService.getOperationalMetrics.mockResolvedValue({
        totalBookings: 50,
        completionRate: 80,
      });

      const result = await service.getMetrics(30);

      expect(result).toEqual({
        totalBookings: 50,
        completionRate: 80,
        averageRating: 4.2,
        sinceDays: 30,
      });
    });
  });
});
