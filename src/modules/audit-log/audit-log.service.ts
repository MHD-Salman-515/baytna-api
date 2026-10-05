import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditAction, AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface RecordAuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Deliberately exposes only `record` and `query` — there is no update or
 * delete method anywhere in this class, which is what makes the log
 * append-only at the application layer.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async record(entry: RecordAuditEntry): Promise<void> {
    await this.auditLogModel.create({
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  async query(filters: QueryAuditLogDto): Promise<PaginatedResult<AuditLog>> {
    const mongoFilter: Record<string, unknown> = {};
    if (filters.action) mongoFilter.action = filters.action;
    if (filters.actorUserId) mongoFilter.actorUserId = filters.actorUserId;
    if (filters.targetType) mongoFilter.targetType = filters.targetType;
    if (filters.targetId) mongoFilter.targetId = filters.targetId;
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = new Date(filters.from);
      if (filters.to) range.$lte = new Date(filters.to);
      mongoFilter.timestamp = range;
    }

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(mongoFilter)
        .sort({ timestamp: -1 })
        .skip(filters.skip)
        .limit(filters.limit)
        .exec(),
      this.auditLogModel.countDocuments(mongoFilter).exec(),
    ]);

    return { data, meta: buildPaginationMeta(filters.page, filters.limit, total) };
  }
}
