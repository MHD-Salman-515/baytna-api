import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { LocationTrackingService } from '../bookings/location-tracking.service';
import {
  BOOKING_NOTIFIER,
  BookingNotifier,
} from '../bookings/notifications/booking-notifier.interface';
import { NotificationEventType } from '../notifications/notification-event';
import { UsersService } from '../users/users.service';
import { QueryAdminPanicAlertsDto } from './dto/query-admin-panic-alerts.dto';
import { ResolvePanicDto } from './dto/resolve-panic.dto';
import { TriggerPanicDto } from './dto/trigger-panic.dto';
import { PanicAlert, PanicAlertDocument, PanicAlertStatus } from './schemas/panic-alert.schema';
import { TrustedContactsService } from './trusted-contacts.service';

// A panic alert only makes sense while the trip is actually happening — not
// before a worker is even dispatched, and not after the job has already
// ended (that's a report/dispute instead). Same set LocationTrackingService
// itself tracks against.
const ACTIVE_STATUSES = [
  BookingStatus.ON_THE_WAY,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

@Injectable()
export class PanicAlertsService {
  private readonly logger = new Logger(PanicAlertsService.name);

  constructor(
    @InjectModel(PanicAlert.name) private readonly panicAlertModel: Model<PanicAlertDocument>,
    private readonly bookingsService: BookingsService,
    private readonly locationTrackingService: LocationTrackingService,
    private readonly usersService: UsersService,
    private readonly trustedContactsService: TrustedContactsService,
    private readonly auditLogService: AuditLogService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // Resolved lazily, same reason as WalletsService's own notifier getter:
  // BOOKING_NOTIFIER is a factory provider inside BookingsModule, never
  // exported, so a constructor injection here would need BookingsModule to
  // export it just for this — ModuleRef avoids that without a new export.
  private get notifier(): BookingNotifier {
    return this.moduleRef.get<BookingNotifier>(BOOKING_NOTIFIER, { strict: false });
  }

  /**
   * The single most time-sensitive write in this app: create the alert
   * record first (so it exists no matter what happens next), then fan out
   * to every admin — each notify() wrapped individually so one admin's
   * failed delivery never hides the alert from the rest, let alone fails
   * the trigger itself back to the user who's in danger.
   */
  async trigger(
    userId: string,
    bookingId: string,
    dto: TriggerPanicDto,
  ): Promise<PanicAlertDocument> {
    const { booking, role } = await this.bookingsService.resolveOwnParty(userId, bookingId);

    if (!ACTIVE_STATUSES.includes(booking.status)) {
      throw new BadRequestException(
        'A panic alert can only be triggered during an active booking (on the way, arrived, or in progress)',
      );
    }

    const [lastKnownLocation, contacts, adminIds] = await Promise.all([
      this.locationTrackingService.getLastKnownPoint(bookingId),
      this.trustedContactsService.listOwn(userId),
      this.usersService.findAdminIds(),
    ]);

    const alert = await this.panicAlertModel.create({
      bookingId,
      triggeredByUserId: userId,
      triggeredByRole: role,
      lastKnownLocation,
      note: dto.note ?? null,
      contactsToNotify: contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        relationship: c.relationship,
      })),
      notifiedAdminIds: adminIds,
    });

    // What would be sent to her trusted contacts — logged exactly like
    // Phase 6's LogNotifier, since there's no SMS provider wired up yet.
    for (const contact of alert.contactsToNotify) {
      this.logger.warn(
        `[TrustedContact (DEV ONLY)] Would SMS ${contact.name} (${contact.relationship}) at ` +
          `${contact.phone}: panic alert on booking ${bookingId}`,
      );
    }

    for (const adminId of adminIds) {
      try {
        await this.notifier.notify({
          type: NotificationEventType.PANIC_ALERT_TRIGGERED,
          recipientUserId: adminId,
          bookingId,
          context: { triggeredByRole: role },
        });
      } catch (error) {
        this.logger.error(
          `Failed to notify admin ${adminId} of panic alert ${alert.id as string}`,
          (error as Error).stack,
        );
      }
    }

    return alert;
  }

  async listForAdmin(
    query: QueryAdminPanicAlertsDto,
  ): Promise<PaginatedResult<PanicAlertDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const [data, total] = await Promise.all([
      this.panicAlertModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.panicAlertModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async getForAdmin(alertId: string): Promise<PanicAlertDocument> {
    const alert = await this.panicAlertModel.findOne({ _id: alertId, isDeleted: false }).exec();
    if (!alert) {
      throw new NotFoundException('Panic alert not found');
    }
    return alert;
  }

  async resolve(
    adminUserId: string,
    alertId: string,
    dto: ResolvePanicDto,
  ): Promise<PanicAlertDocument> {
    const alert = await this.getForAdmin(alertId);

    alert.status = PanicAlertStatus.RESOLVED;
    alert.resolvedBy = adminUserId as unknown as PanicAlertDocument['resolvedBy'];
    alert.resolvedAt = new Date();
    alert.resolutionNote = dto.resolutionNote;
    await alert.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.PANIC_ALERT_RESOLVED,
      targetType: 'PanicAlert',
      targetId: alertId,
      metadata: { resolutionNote: dto.resolutionNote },
    });

    return alert;
  }
}
