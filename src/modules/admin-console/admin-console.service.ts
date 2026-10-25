import { Injectable } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BookingsService } from '../bookings/bookings.service';
import { AdminFindBookingsQueryDto } from '../bookings/dto/admin-find-bookings-query.dto';
import { PanicAlertsService } from '../safety/panic-alerts.service';
import { PanicAlertStatus } from '../safety/schemas/panic-alert.schema';
import { ReportsService } from '../reports/reports.service';
import { ReportStatus } from '../reports/schemas/report.schema';
import { ReviewsService } from '../reviews/reviews.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WorkerDocumentsService } from '../workers/worker-documents.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { VerificationStatus } from '../workers/schemas/worker-profile.schema';

// Only the count is needed from these lookups — page 1, limit 1 — so the
// list query itself stays cheap; `.meta.total` is the only field read.
const COUNT_ONLY: PaginationQueryDto = { page: 1, limit: 1, skip: 0 };

export interface AdminDashboard {
  bookingsToday: Record<string, number>;
  bookingsThisWeek: Record<string, number>;
  pendingVerifications: number;
  openReports: number;
  unresolvedPanicAlerts: number;
  workersBelowLowBalanceThreshold: number;
  instantMatchingFailureRate: {
    totalInstant: number;
    noWorkerFound: number;
    ratePercent: number;
  };
}

export interface AdminSearchResult {
  users: Record<string, unknown>[];
  workers: Record<string, unknown>[];
  bookings: Record<string, unknown>[];
}

@Injectable()
export class AdminConsoleService {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerDocumentsService: WorkerDocumentsService,
    private readonly workerServicesService: WorkerServicesService,
    private readonly reviewsService: ReviewsService,
    private readonly walletsService: WalletsService,
    private readonly reportsService: ReportsService,
    private readonly panicAlertsService: PanicAlertsService,
    private readonly usersService: UsersService,
  ) {}

  async getDashboard(): Promise<AdminDashboard> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const [
      bookingsToday,
      bookingsThisWeek,
      pendingVerifications,
      openReports,
      investigatingReports,
      unresolvedPanicAlerts,
      lowBalanceWorkers,
      instantMatchingFailureRate,
    ] = await Promise.all([
      this.bookingsService.getStatusCountsSince(startOfToday),
      this.bookingsService.getStatusCountsSince(startOfWeek),
      this.workerProfilesService.listForAdmin({
        ...COUNT_ONLY,
        status: VerificationStatus.PENDING_REVIEW,
      } as never),
      this.reportsService.listForAdmin({ ...COUNT_ONLY, status: ReportStatus.OPEN } as never),
      this.reportsService.listForAdmin({
        ...COUNT_ONLY,
        status: ReportStatus.INVESTIGATING,
      } as never),
      this.panicAlertsService.listForAdmin({
        ...COUNT_ONLY,
        status: PanicAlertStatus.OPEN,
      } as never),
      this.walletsService.listForAdmin({ ...COUNT_ONLY, lowBalance: true } as never),
      this.bookingsService.getInstantMatchingFailureRate(startOfWeek),
    ]);

    return {
      bookingsToday,
      bookingsThisWeek,
      pendingVerifications: pendingVerifications.meta.total,
      openReports: openReports.meta.total + investigatingReports.meta.total,
      unresolvedPanicAlerts: unresolvedPanicAlerts.meta.total,
      workersBelowLowBalanceThreshold: lowBalanceWorkers.meta.total,
      instantMatchingFailureRate,
    };
  }

  /**
   * Three independent lookups, not one unified collection scan — "users",
   * "workers" and "bookings" are different shapes for different purposes,
   * same reasoning the rest of this app never merges unlike entities into
   * one projection. A user who also holds WORKER surfaces in both buckets,
   * each with the context relevant to that bucket.
   */
  async search(query: {
    phone?: string;
    name?: string;
    bookingNumber?: string;
  }): Promise<AdminSearchResult> {
    const [matchedUsers, bookings] = await Promise.all([
      query.phone || query.name
        ? this.usersService.searchByPhoneOrName(query.phone ?? query.name!)
        : Promise.resolve([]),
      query.bookingNumber
        ? this.bookingsService.searchByBookingNumberPrefix(query.bookingNumber)
        : Promise.resolve([]),
    ]);

    const users = matchedUsers.map((user) => ({
      id: user.id as string,
      phone: user.phone,
      roles: user.roles,
      status: user.status,
      displayName: [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' '),
    }));

    const workerUsers = matchedUsers.filter((user) => user.roles.includes(Role.WORKER));
    const workers = (
      await Promise.all(
        workerUsers.map(async (user) => {
          try {
            const profile = await this.workerProfilesService.getOwn(user.id as string);
            return {
              workerProfileId: profile.id as string,
              userId: user.id as string,
              phone: user.phone,
              verificationStatus: profile.verificationStatus,
              financialStatus: profile.financialStatus,
              rating: profile.rating,
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter((w): w is NonNullable<typeof w> => w !== null);

    const projectedBookings = await Promise.all(
      bookings.map((booking) => this.bookingsService.projectForAdmin(booking)),
    );

    return { users, workers, bookings: projectedBookings };
  }

  /** Pulls together everything an admin would otherwise have to open seven different screens to see. */
  async getWorker360(workerProfileId: string): Promise<Record<string, unknown>> {
    const bookingsQuery: AdminFindBookingsQueryDto = {
      page: 1,
      limit: 10,
      skip: 0,
      workerProfileId,
    } as never;

    const [profile, documents, services, bookings, reviews, wallet, reports] = await Promise.all([
      this.workerProfilesService.getForAdminWithUser(workerProfileId),
      this.workerDocumentsService.listForAdmin(workerProfileId),
      this.workerServicesService.listForAdmin(workerProfileId),
      this.bookingsService.listForAdmin(bookingsQuery),
      this.reviewsService.listForAdmin({
        page: 1,
        limit: 10,
        skip: 0,
        subjectId: workerProfileId,
      } as never),
      this.walletsService.getForAdmin(workerProfileId),
      this.reportsService.listForAdmin({
        page: 1,
        limit: 10,
        skip: 0,
        subjectId: workerProfileId,
      } as never),
    ]);

    const projectedBookings = await Promise.all(
      bookings.data.map((booking) => this.bookingsService.projectForAdmin(booking)),
    );

    return {
      profile,
      documents,
      services,
      recentBookings: projectedBookings,
      recentReviews: reviews.data,
      wallet,
      reports: reports.data,
    };
  }

  async getMetrics(sinceDays: number): Promise<Record<string, unknown>> {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const [bookingMetrics, averageRating] = await Promise.all([
      this.bookingsService.getOperationalMetrics(since),
      this.workerProfilesService.getAverageRating(),
    ]);
    return { ...bookingMetrics, averageRating, sinceDays };
  }
}
