import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { FileStorage } from '../storage/file-storage.interface';
import { WalletsService } from '../wallets/wallets.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { ReportsService } from './reports.service';
import { ReportResolutionAction, ReportStatus, ReportSubjectType } from './schemas/report.schema';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

// A minimal valid JPEG header, enough for detectMimeTypeFromMagicBytes.
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('ReportsService', () => {
  let service: ReportsService;
  let reportModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let storage: { putObject: jest.Mock; getPresignedDownloadUrl: jest.Mock };
  let bookingsService: { resolveOwnParty: jest.Mock; forceStatus: jest.Mock };
  let workerProfilesService: { reviewWorker: jest.Mock };
  let walletsService: { adjust: jest.Mock };
  let auditLogService: { record: jest.Mock };

  const reporterId = 'reporter-1';
  const workerProfileId = 'worker-profile-1';
  const bookingId = 'booking-1';

  beforeEach(() => {
    reportModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
    };
    bookingsService = {
      resolveOwnParty: jest.fn().mockResolvedValue({ role: Role.CUSTOMER }),
      forceStatus: jest.fn().mockResolvedValue(undefined),
    };
    workerProfilesService = { reviewWorker: jest.fn().mockResolvedValue(undefined) };
    walletsService = { adjust: jest.fn().mockResolvedValue(undefined) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new ReportsService(
      reportModel as never,
      storage as unknown as FileStorage,
      bookingsService as unknown as BookingsService,
      workerProfilesService as unknown as WorkerProfilesService,
      walletsService as unknown as WalletsService,
      auditLogService as unknown as AuditLogService,
    );
  });

  describe('file', () => {
    it('derives reporterRole from the booking when one is given, never trusting the client for it', async () => {
      bookingsService.resolveOwnParty.mockResolvedValue({ role: Role.WORKER });
      reportModel.create.mockResolvedValue({
        id: 'report-1',
        subjectId: { toString: () => workerProfileId },
        bookingId: null,
        attachments: [],
      });

      await service.file(reporterId, [Role.CUSTOMER, Role.WORKER], {
        subjectType: ReportSubjectType.USER,
        subjectId: 'customer-2',
        bookingId,
        category: 'OTHER' as never,
        description: 'Issue',
      });

      expect(bookingsService.resolveOwnParty).toHaveBeenCalledWith(reporterId, bookingId);
      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ reporterRole: Role.WORKER }),
      );
    });

    it('propagates resolveOwnParty rejecting a non-party for the named booking', async () => {
      bookingsService.resolveOwnParty.mockRejectedValue(new NotFoundException());

      await expect(
        service.file(reporterId, [Role.CUSTOMER], {
          subjectType: ReportSubjectType.BOOKING,
          subjectId: bookingId,
          bookingId,
          category: 'OTHER' as never,
          description: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('flags HARASSMENT and THEFT as high severity', async () => {
      reportModel.create.mockResolvedValue({
        id: 'report-2',
        subjectId: { toString: () => 'x' },
        bookingId: null,
        attachments: [],
      });

      await service.file(reporterId, [Role.CUSTOMER], {
        subjectType: ReportSubjectType.WORKER,
        subjectId: workerProfileId,
        category: 'HARASSMENT' as never,
        description: 'x',
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ isHighSeverity: true }),
      );
    });

    it('does not flag QUALITY as high severity', async () => {
      reportModel.create.mockResolvedValue({
        id: 'report-3',
        subjectId: { toString: () => 'x' },
        bookingId: null,
        attachments: [],
      });

      await service.file(reporterId, [Role.CUSTOMER], {
        subjectType: ReportSubjectType.WORKER,
        subjectId: workerProfileId,
        category: 'QUALITY' as never,
        description: 'x',
      });

      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ isHighSeverity: false }),
      );
    });
  });

  describe('uploadAttachmentOwn', () => {
    it('stores the file and returns the view without internalNotes', async () => {
      const report = {
        reporterId,
        attachments: [] as unknown[],
        subjectId: { toString: () => 'x' },
        bookingId: null,
        save: jest.fn().mockResolvedValue(undefined),
      };
      reportModel.findOne.mockReturnValue(chainExec(report));

      const view = await service.uploadAttachmentOwn(reporterId, 'report-1', {
        buffer: JPEG_HEADER,
        mimetype: 'image/jpeg',
      });

      expect(storage.putObject).toHaveBeenCalledWith(expect.any(String), JPEG_HEADER, 'image/jpeg');
      expect(report.attachments).toHaveLength(1);
      expect(view).not.toHaveProperty('internalNotes');
    });

    it('rejects a file whose magic bytes are not recognized', async () => {
      const report = {
        attachments: [],
        subjectId: { toString: () => 'x' },
        bookingId: null,
        save: jest.fn(),
      };
      reportModel.findOne.mockReturnValue(chainExec(report));

      await expect(
        service.uploadAttachmentOwn(reporterId, 'report-1', {
          buffer: Buffer.from('not a real file'),
          mimetype: 'image/jpeg',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for a report that is not hers', async () => {
      reportModel.findOne.mockReturnValue(chainExec(null));

      await expect(
        service.uploadAttachmentOwn(reporterId, 'not-mine', {
          buffer: JPEG_HEADER,
          mimetype: 'image/jpeg',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOwn / listOwn projection', () => {
    it('never includes internalNotes or assignedTo in the reporter-facing view', async () => {
      reportModel.findOne.mockReturnValue(
        chainExec({
          id: 'report-1',
          subjectId: { toString: () => 'x' },
          bookingId: null,
          attachments: [],
          internalNotes: [{ authorId: 'admin-1', note: 'internal stuff', createdAt: new Date() }],
          assignedTo: 'admin-1',
          status: ReportStatus.OPEN,
        }),
      );

      const view = await service.getOwn(reporterId, 'report-1');

      expect(view).not.toHaveProperty('internalNotes');
      expect(view).not.toHaveProperty('assignedTo');
      expect(JSON.stringify(view)).not.toContain('internal stuff');
    });
  });

  describe('listForAdmin', () => {
    it('sorts high-severity reports first, then by recency', async () => {
      const sort = jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue(chainExec([])) }),
      });
      reportModel.find.mockReturnValue({ sort });
      reportModel.countDocuments.mockReturnValue(chainExec(0));

      await service.listForAdmin({ page: 1, limit: 20, skip: 0 } as never);

      expect(sort).toHaveBeenCalledWith({ isHighSeverity: -1, createdAt: -1 });
    });
  });

  describe('resolve', () => {
    function openReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'report-1',
        subjectType: ReportSubjectType.WORKER,
        subjectId: { toString: () => workerProfileId },
        bookingId: null,
        status: ReportStatus.OPEN,
        resolutionAction: null,
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('SUSPEND_WORKER calls WorkerProfilesService.reviewWorker with action "suspend", never touching financialStatus', async () => {
      const report = openReport();
      reportModel.findOne.mockReturnValue(chainExec(report));

      await service.resolve('admin-1', 'report-1', {
        action: ReportResolutionAction.SUSPEND_WORKER,
        note: 'Confirmed harassment complaint',
      });

      expect(workerProfilesService.reviewWorker).toHaveBeenCalledWith('admin-1', workerProfileId, {
        action: 'suspend',
        reason: { en: 'Confirmed harassment complaint' },
      });
      expect(report.status).toBe(ReportStatus.RESOLVED);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.REPORT_RESOLVED }),
      );
    });

    it('SUSPEND_WORKER rejects a non-WORKER-subject report', async () => {
      const report = openReport({ subjectType: ReportSubjectType.USER });
      reportModel.findOne.mockReturnValue(chainExec(report));

      await expect(
        service.resolve('admin-1', 'report-1', {
          action: ReportResolutionAction.SUSPEND_WORKER,
          note: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(workerProfilesService.reviewWorker).not.toHaveBeenCalled();
    });

    it("FORCE_NO_SHOW calls BookingsService.forceStatus with the report's bookingId", async () => {
      const report = openReport({ bookingId: { toString: () => bookingId } });
      reportModel.findOne.mockReturnValue(chainExec(report));

      await service.resolve('admin-1', 'report-1', {
        action: ReportResolutionAction.FORCE_NO_SHOW,
        note: 'Confirmed no-show',
      });

      expect(bookingsService.forceStatus).toHaveBeenCalledWith('admin-1', bookingId, {
        status: BookingStatus.NO_SHOW,
        reason: 'Confirmed no-show',
      });
    });

    it('FORCE_NO_SHOW rejects a report with no bookingId', async () => {
      const report = openReport({ bookingId: null });
      reportModel.findOne.mockReturnValue(chainExec(report));

      await expect(
        service.resolve('admin-1', 'report-1', {
          action: ReportResolutionAction.FORCE_NO_SHOW,
          note: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('WALLET_ADJUSTMENT calls WalletsService.adjust with the given amount and reuses its own audit trail', async () => {
      const report = openReport();
      reportModel.findOne.mockReturnValue(chainExec(report));

      await service.resolve('admin-1', 'report-1', {
        action: ReportResolutionAction.WALLET_ADJUSTMENT,
        note: 'Deducting for damaged property',
        adjustAmount: -5000,
      });

      expect(walletsService.adjust).toHaveBeenCalledWith('admin-1', workerProfileId, {
        amount: -5000,
        reason: 'Deducting for damaged property',
      });
    });

    it('WALLET_ADJUSTMENT rejects when adjustAmount is missing', async () => {
      const report = openReport();
      reportModel.findOne.mockReturnValue(chainExec(report));

      await expect(
        service.resolve('admin-1', 'report-1', {
          action: ReportResolutionAction.WALLET_ADJUSTMENT,
          note: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('DISMISS resolves with no side-effecting call to any other service', async () => {
      const report = openReport();
      reportModel.findOne.mockReturnValue(chainExec(report));

      await service.resolve('admin-1', 'report-1', {
        action: ReportResolutionAction.DISMISS,
        note: 'No evidence found',
      });

      expect(report.status).toBe(ReportStatus.RESOLVED);
      expect(report.resolutionAction).toBe(ReportResolutionAction.DISMISS);
      expect(workerProfilesService.reviewWorker).not.toHaveBeenCalled();
      expect(bookingsService.forceStatus).not.toHaveBeenCalled();
      expect(walletsService.adjust).not.toHaveBeenCalled();
    });
  });

  describe('attachment download', () => {
    it('audit-logs REPORT_ATTACHMENT_VIEWED before presigning', async () => {
      const report = {
        id: 'report-1',
        attachments: [{ storageKey: 'key-1', mimeType: 'image/jpeg', sizeBytes: 10 }],
        subjectId: { toString: () => 'x' },
        bookingId: null,
      };
      reportModel.findOne.mockReturnValue(chainExec(report));

      const calls: string[] = [];
      auditLogService.record.mockImplementation(async () => {
        calls.push('audit');
      });
      storage.getPresignedDownloadUrl.mockImplementation(async () => {
        calls.push('presign');
        return 'https://signed.example/file';
      });

      await service.getAttachmentDownloadUrlForAdmin('admin-1', 'report-1', 0);

      expect(calls).toEqual(['audit', 'presign']);
    });

    it('throws NotFoundException for an out-of-range attachment index', async () => {
      const report = {
        id: 'report-1',
        attachments: [],
        subjectId: { toString: () => 'x' },
        bookingId: null,
      };
      reportModel.findOne.mockReturnValue(chainExec(report));

      await expect(
        service.getAttachmentDownloadUrlForAdmin('admin-1', 'report-1', 0),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
