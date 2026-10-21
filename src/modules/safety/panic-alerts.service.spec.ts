import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { LocationTrackingService } from '../bookings/location-tracking.service';
import { NotificationEventType } from '../notifications/notification-event';
import { UsersService } from '../users/users.service';
import { PanicAlertsService } from './panic-alerts.service';
import { PanicAlertStatus } from './schemas/panic-alert.schema';
import { TrustedContactsService } from './trusted-contacts.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('PanicAlertsService', () => {
  let service: PanicAlertsService;
  let panicAlertModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let bookingsService: { resolveOwnParty: jest.Mock };
  let locationTrackingService: { getLastKnownPoint: jest.Mock };
  let usersService: { findAdminIds: jest.Mock };
  let trustedContactsService: { listOwn: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let notifier: { notify: jest.Mock };

  const bookingId = 'booking-1';
  const userId = 'customer-1';

  function activeBooking(overrides: Record<string, unknown> = {}) {
    return { status: BookingStatus.IN_PROGRESS, ...overrides };
  }

  beforeEach(() => {
    panicAlertModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    bookingsService = { resolveOwnParty: jest.fn() };
    locationTrackingService = { getLastKnownPoint: jest.fn().mockResolvedValue(null) };
    usersService = { findAdminIds: jest.fn().mockResolvedValue(['admin-1', 'admin-2']) };
    trustedContactsService = { listOwn: jest.fn().mockResolvedValue([]) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = { get: jest.fn().mockReturnValue(notifier) };

    service = new PanicAlertsService(
      panicAlertModel as never,
      bookingsService as unknown as BookingsService,
      locationTrackingService as unknown as LocationTrackingService,
      usersService as unknown as UsersService,
      trustedContactsService as unknown as TrustedContactsService,
      auditLogService as unknown as AuditLogService,
      moduleRef as unknown as ModuleRef,
    );
  });

  describe('trigger', () => {
    it('creates the alert and notifies every admin individually', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: activeBooking(),
        role: Role.CUSTOMER,
      });
      panicAlertModel.create.mockResolvedValue({ id: 'alert-1', contactsToNotify: [] });

      await service.trigger(userId, bookingId, { note: 'Feeling unsafe' });

      expect(panicAlertModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          triggeredByUserId: userId,
          triggeredByRole: Role.CUSTOMER,
          note: 'Feeling unsafe',
          notifiedAdminIds: ['admin-1', 'admin-2'],
        }),
      );
      expect(notifier.notify).toHaveBeenCalledTimes(2);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.PANIC_ALERT_TRIGGERED,
          recipientUserId: 'admin-1',
          bookingId,
          context: { triggeredByRole: Role.CUSTOMER },
        }),
      );
    });

    it('rejects when the booking is not in an active status', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: activeBooking({ status: BookingStatus.PENDING_WORKER }),
        role: Role.CUSTOMER,
      });

      await expect(service.trigger(userId, bookingId, {})).rejects.toThrow(BadRequestException);
      expect(panicAlertModel.create).not.toHaveBeenCalled();
    });

    it('records the trusted-contact snapshot at trigger time, not a live reference', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: activeBooking(),
        role: Role.WORKER,
      });
      trustedContactsService.listOwn.mockResolvedValue([
        { name: 'Mother', phone: '+963900000000', relationship: 'Mother' },
      ]);
      panicAlertModel.create.mockResolvedValue({
        id: 'alert-2',
        contactsToNotify: [{ name: 'Mother', phone: '+963900000000', relationship: 'Mother' }],
      });

      await service.trigger(userId, bookingId, {});

      expect(panicAlertModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contactsToNotify: [{ name: 'Mother', phone: '+963900000000', relationship: 'Mother' }],
        }),
      );
    });

    it('never fails the trigger itself when one admin notification fails', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({
        booking: activeBooking(),
        role: Role.CUSTOMER,
      });
      panicAlertModel.create.mockResolvedValue({ id: 'alert-3', contactsToNotify: [] });
      notifier.notify
        .mockRejectedValueOnce(new Error('push gateway down'))
        .mockResolvedValueOnce(undefined);

      await expect(service.trigger(userId, bookingId, {})).resolves.toBeDefined();
      expect(notifier.notify).toHaveBeenCalledTimes(2);
    });

    it('propagates resolveOwnParty rejecting a non-party', async () => {
      bookingsService.resolveOwnParty.mockRejectedValue(new NotFoundException());

      await expect(service.trigger('stranger', bookingId, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve', () => {
    it('resolves an open alert and audit-logs it', async () => {
      const alert = {
        id: 'alert-1',
        status: PanicAlertStatus.OPEN,
        save: jest.fn().mockResolvedValue(undefined),
      };
      panicAlertModel.findOne.mockReturnValue(chainExec(alert));

      await service.resolve('admin-1', 'alert-1', { resolutionNote: 'False alarm' });

      expect(alert.status).toBe(PanicAlertStatus.RESOLVED);
      expect(alert.save).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: AuditAction.PANIC_ALERT_RESOLVED,
          targetId: 'alert-1',
        }),
      );
    });

    it('throws NotFoundException for a missing alert', async () => {
      panicAlertModel.findOne.mockReturnValue(chainExec(null));

      await expect(service.resolve('admin-1', 'nope', { resolutionNote: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
