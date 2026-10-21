import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { detectMimeTypeFromMagicBytes } from '../storage/file-validation.util';
import { generateObjectKey } from '../storage/generate-object-key';
import { FileStorage } from '../storage/file-storage.interface';
import {
  FILE_STORAGE,
  MAX_FILE_SIZE_BYTES,
  MAX_PRESIGNED_URL_TTL_SECONDS,
} from '../storage/storage.constants';
import { WalletsService } from '../wallets/wallets.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { AssignReportDto } from './dto/assign-report.dto';
import { ChangeReportStatusDto } from './dto/change-report-status.dto';
import { AddReportNoteDto } from './dto/add-report-note.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { QueryAdminReportsDto } from './dto/query-admin-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { toOwnReportView } from './report-projection';
import {
  HIGH_SEVERITY_CATEGORIES,
  Report,
  ReportDocument,
  ReportResolutionAction,
  ReportStatus,
  ReportSubjectType,
} from './schemas/report.schema';

export interface UploadAttachmentInput {
  buffer: Buffer;
  mimetype: string;
}

export interface PresignedAttachmentDownload {
  url: string;
  expiresInSeconds: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<ReportDocument>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly bookingsService: BookingsService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly walletsService: WalletsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * `callerRoles` is her full JWT role set (she may hold both CUSTOMER and
   * WORKER) — when the report names a booking, her reporterRole is derived
   * from which side of THAT booking she actually is (via resolveOwnParty,
   * which also enforces "only its parties may report it"), never trusted
   * from the client. With no booking attached there's no booking to derive
   * it from, so it falls back to WORKER only if that's the only role she
   * has — otherwise CUSTOMER, a reasonable default for someone holding both.
   */
  async file(
    reporterId: string,
    callerRoles: Role[],
    dto: CreateReportDto,
  ): Promise<Record<string, unknown>> {
    let reporterRole: Role.CUSTOMER | Role.WORKER = callerRoles.includes(Role.CUSTOMER)
      ? Role.CUSTOMER
      : Role.WORKER;

    if (dto.bookingId) {
      const { role } = await this.bookingsService.resolveOwnParty(reporterId, dto.bookingId);
      reporterRole = role;
    }

    const report = await this.reportModel.create({
      reporterId,
      reporterRole,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      bookingId: dto.bookingId ?? null,
      category: dto.category,
      isHighSeverity: HIGH_SEVERITY_CATEGORIES.has(dto.category),
      description: dto.description,
    });
    return toOwnReportView(report);
  }

  async uploadAttachmentOwn(
    reporterId: string,
    reportId: string,
    file: UploadAttachmentInput,
  ): Promise<Record<string, unknown>> {
    const report = await this.getOwnOrThrow(reporterId, reportId);

    if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit`);
    }
    const detectedMimeType = detectMimeTypeFromMagicBytes(file.buffer);
    if (!detectedMimeType) {
      throw new BadRequestException('File type not recognized. Allowed: JPEG, PNG, PDF.');
    }

    const key = generateObjectKey();
    await this.storage.putObject(key, file.buffer, detectedMimeType);

    report.attachments.push({
      storageKey: key,
      mimeType: detectedMimeType,
      sizeBytes: file.buffer.length,
      uploadedAt: new Date(),
    });
    await report.save();
    return toOwnReportView(report);
  }

  async listOwn(
    reporterId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter = { reporterId, isDeleted: false };
    const [data, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.reportModel.countDocuments(filter).exec(),
    ]);
    return {
      data: data.map(toOwnReportView),
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  async getOwn(reporterId: string, reportId: string): Promise<Record<string, unknown>> {
    const report = await this.getOwnOrThrow(reporterId, reportId);
    return toOwnReportView(report);
  }

  async getAttachmentDownloadUrlOwn(
    reporterId: string,
    reportId: string,
    attachmentIndex: number,
  ): Promise<PresignedAttachmentDownload> {
    const report = await this.getOwnOrThrow(reporterId, reportId);
    return this.presignAttachment(reporterId, report, attachmentIndex);
  }

  async listForAdmin(query: QueryAdminReportsDto): Promise<PaginatedResult<ReportDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;

    const [data, total] = await Promise.all([
      this.reportModel
        .find(filter)
        // High-severity first, never buried in a long list — then newest first.
        .sort({ isHighSeverity: -1, createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.reportModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async getForAdmin(reportId: string): Promise<ReportDocument> {
    const report = await this.reportModel.findOne({ _id: reportId, isDeleted: false }).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  async getAttachmentDownloadUrlForAdmin(
    adminUserId: string,
    reportId: string,
    attachmentIndex: number,
  ): Promise<PresignedAttachmentDownload> {
    const report = await this.getForAdmin(reportId);
    return this.presignAttachment(adminUserId, report, attachmentIndex);
  }

  async assign(
    adminUserId: string,
    reportId: string,
    dto: AssignReportDto,
  ): Promise<ReportDocument> {
    const report = await this.getForAdmin(reportId);
    report.assignedTo = dto.assignedTo as unknown as ReportDocument['assignedTo'];
    await report.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.REPORT_ASSIGNED,
      targetType: 'Report',
      targetId: reportId,
      metadata: { assignedTo: dto.assignedTo },
    });
    return report;
  }

  async changeStatus(
    adminUserId: string,
    reportId: string,
    dto: ChangeReportStatusDto,
  ): Promise<ReportDocument> {
    const report = await this.getForAdmin(reportId);
    const previousStatus = report.status;
    report.status = dto.status;
    await report.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.REPORT_STATUS_CHANGED,
      targetType: 'Report',
      targetId: reportId,
      metadata: { from: previousStatus, to: dto.status },
    });
    return report;
  }

  async addInternalNote(
    adminUserId: string,
    reportId: string,
    dto: AddReportNoteDto,
  ): Promise<ReportDocument> {
    const report = await this.getForAdmin(reportId);
    report.internalNotes.push({
      authorId: adminUserId as unknown as ReportDocument['internalNotes'][number]['authorId'],
      note: dto.note,
      createdAt: new Date(),
    });
    await report.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.REPORT_NOTE_ADDED,
      targetType: 'Report',
      targetId: reportId,
      metadata: {},
    });
    return report;
  }

  /**
   * Every action here reuses an existing service wholesale — this method
   * never recomputes a wallet balance, a verification-status transition, or
   * a booking-state transition itself. A disciplinary suspension
   * (SUSPEND_WORKER) goes through WorkerProfilesService.reviewWorker, which
   * only ever touches verificationStatus — financialStatus is a completely
   * separate field this code path never reaches, so a report-driven
   * suspension can never silently affect her wallet eligibility.
   */
  async resolve(
    adminUserId: string,
    reportId: string,
    dto: ResolveReportDto,
  ): Promise<ReportDocument> {
    const report = await this.getForAdmin(reportId);

    switch (dto.action) {
      case ReportResolutionAction.SUSPEND_WORKER: {
        if (report.subjectType !== ReportSubjectType.WORKER) {
          throw new BadRequestException('SUSPEND_WORKER requires a WORKER-subject report');
        }
        await this.workerProfilesService.reviewWorker(adminUserId, report.subjectId.toString(), {
          action: 'suspend',
          reason: { en: dto.note },
        });
        break;
      }
      case ReportResolutionAction.FORCE_NO_SHOW: {
        if (!report.bookingId) {
          throw new BadRequestException('FORCE_NO_SHOW requires a report with a bookingId');
        }
        await this.bookingsService.forceStatus(adminUserId, report.bookingId.toString(), {
          status: BookingStatus.NO_SHOW,
          reason: dto.note,
        });
        break;
      }
      case ReportResolutionAction.WALLET_ADJUSTMENT: {
        if (report.subjectType !== ReportSubjectType.WORKER) {
          throw new BadRequestException('WALLET_ADJUSTMENT requires a WORKER-subject report');
        }
        if (dto.adjustAmount === undefined) {
          throw new BadRequestException('adjustAmount is required for WALLET_ADJUSTMENT');
        }
        await this.walletsService.adjust(adminUserId, report.subjectId.toString(), {
          amount: dto.adjustAmount,
          reason: dto.note,
        });
        break;
      }
      case ReportResolutionAction.DISMISS:
        break;
    }

    report.status = ReportStatus.RESOLVED;
    report.resolutionAction = dto.action;
    report.resolution = dto.note;
    report.resolvedBy = adminUserId as unknown as ReportDocument['resolvedBy'];
    report.resolvedAt = new Date();
    await report.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.REPORT_RESOLVED,
      targetType: 'Report',
      targetId: reportId,
      metadata: { action: dto.action, note: dto.note },
    });
    return report;
  }

  private async getOwnOrThrow(reporterId: string, reportId: string): Promise<ReportDocument> {
    const report = await this.reportModel
      .findOne({ _id: reportId, reporterId, isDeleted: false })
      .exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  /** Audit-BEFORE-url, same ordering WorkerDocumentsService uses — a failed audit write means no URL. */
  private async presignAttachment(
    actorUserId: string,
    report: ReportDocument,
    attachmentIndex: number,
  ): Promise<PresignedAttachmentDownload> {
    const attachment = report.attachments[attachmentIndex];
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    await this.auditLogService.record({
      actorUserId,
      action: AuditAction.REPORT_ATTACHMENT_VIEWED,
      targetType: 'Report',
      targetId: report.id as string,
      metadata: { attachmentIndex },
    });

    const url = await this.storage.getPresignedDownloadUrl(
      attachment.storageKey,
      MAX_PRESIGNED_URL_TTL_SECONDS,
    );
    return { url, expiresInSeconds: MAX_PRESIGNED_URL_TTL_SECONDS };
  }
}
