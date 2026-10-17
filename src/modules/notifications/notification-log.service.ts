import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  NotificationChannel,
  NotificationLog,
  NotificationLogDocument,
  NotificationOutcome,
} from './schemas/notification-log.schema';

export interface RecordNotificationLogEntry {
  userId: string;
  type: string;
  channel: NotificationChannel;
  outcome: NotificationOutcome;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface QueryNotificationLogFilters extends PaginationQueryDto {
  userId?: string;
  type?: string;
  outcome?: NotificationOutcome;
}

/** Append-only: only `record` and `query` exist, same discipline as AuditLogService. */
@Injectable()
export class NotificationLogService {
  constructor(
    @InjectModel(NotificationLog.name) private readonly logModel: Model<NotificationLogDocument>,
  ) {}

  async record(entry: RecordNotificationLogEntry): Promise<void> {
    await this.logModel.create({
      userId: entry.userId,
      type: entry.type,
      channel: entry.channel,
      outcome: entry.outcome,
      providerMessageId: entry.providerMessageId ?? null,
      errorMessage: entry.errorMessage ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  async query(filters: QueryNotificationLogFilters): Promise<PaginatedResult<NotificationLog>> {
    const mongoFilter: Record<string, unknown> = {};
    if (filters.userId) mongoFilter.userId = filters.userId;
    if (filters.type) mongoFilter.type = filters.type;
    if (filters.outcome) mongoFilter.outcome = filters.outcome;

    const [data, total] = await Promise.all([
      this.logModel
        .find(mongoFilter)
        .sort({ sentAt: -1 })
        .skip(filters.skip)
        .limit(filters.limit)
        .exec(),
      this.logModel.countDocuments(mongoFilter).exec(),
    ]);

    return { data, meta: buildPaginationMeta(filters.page, filters.limit, total) };
  }
}
