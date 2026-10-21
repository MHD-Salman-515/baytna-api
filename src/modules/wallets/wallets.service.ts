import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import {
  BookingNotifier,
  BOOKING_NOTIFIER,
} from '../bookings/notifications/booking-notifier.interface';
import { NotificationEventType } from '../notifications/notification-event';
import { FinancialStatus, WorkerProfileDocument } from '../workers/schemas/worker-profile.schema';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { QueryAdminWalletsDto } from './dto/query-admin-wallets.dto';
import { ReverseWalletEntryDto } from './dto/reverse-wallet-entry.dto';
import { TopupWalletDto } from './dto/topup-wallet.dto';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { WalletEntry, WalletEntryDocument, WalletEntryType } from './schemas/wallet-entry.schema';

export interface RecordWalletEntryParams {
  walletId: string;
  bookingId?: string | null;
  type: WalletEntryType;
  amount: number;
  currency: string;
  idempotencyKey: string;
  createdBy: string | null;
  reversesEntryId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordWalletEntryResult {
  entry: WalletEntryDocument;
  /** true if idempotencyKey already existed — no new balance change happened on this call. */
  deduped: boolean;
}

/**
 * The money ledger (see WalletEntry's own doc comment for the append-only
 * guarantee) plus the suspension/reinstatement rules layered on top of it.
 * Resolves BOOKING_NOTIFIER lazily via ModuleRef rather than a constructor
 * injection, specifically to avoid WalletsModule needing to import
 * BookingsModule/NotificationsModule at all — see BaseNotifier's own
 * comment on the identical circular-DI trap this sidesteps (found live,
 * Phase 7).
 */
@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectModel(Wallet.name) private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletEntry.name) private readonly entryModel: Model<WalletEntryDocument>,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly countriesService: CountriesService,
    private readonly auditLogService: AuditLogService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get notifier(): BookingNotifier {
    return this.moduleRef.get<BookingNotifier>(BOOKING_NOTIFIER, { strict: false });
  }

  /** Lazily created on first need — a worker who's never topped up or been charged simply has none yet. */
  async getOrCreateWallet(workerProfileId: string): Promise<WalletDocument> {
    const existing = await this.walletModel.findOne({ workerProfileId }).exec();
    if (existing) {
      return existing;
    }

    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    const country = await this.countriesService.findOne(profile.countryId.toString());
    try {
      return await this.walletModel.create({
        workerProfileId,
        countryId: profile.countryId,
        balance: 0,
        currency: country.currencyCode,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        // Lost a creation race — someone else's concurrent call created it microseconds ago.
        const wallet = await this.walletModel.findOne({ workerProfileId }).exec();
        if (wallet) {
          return wallet;
        }
      }
      throw error;
    }
  }

  async getOwn(userId: string): Promise<WalletDocument> {
    const profile = await this.workerProfilesService.getOwn(userId);
    return this.getOrCreateWallet(profile.id as string);
  }

  async getForAdmin(workerProfileId: string): Promise<WalletDocument> {
    return this.getOrCreateWallet(workerProfileId);
  }

  async listForAdmin(query: QueryAdminWalletsDto): Promise<PaginatedResult<WalletDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) {
      const ids = await this.workerProfilesService.listIdsByFinancialStatus(query.status);
      filter.workerProfileId = { $in: ids };
    }

    if (!query.lowBalance) {
      const [data, total] = await Promise.all([
        this.walletModel
          .find(filter)
          .sort({ updatedAt: -1 })
          .skip(query.skip)
          .limit(query.limit)
          .exec(),
        this.walletModel.countDocuments(filter).exec(),
      ]);
      return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
    }

    // "Low balance" is relative to each wallet's OWN country policy, so it
    // can't be expressed as a single Mongo comparison — resolved in memory,
    // the same tradeoff PublicWorkersService already makes for its own
    // cross-collection "sort by price" query. Fine at today's admin-tooling scale.
    const all = await this.walletModel.find(filter).exec();
    const countryIds = [...new Set(all.map((w) => w.countryId.toString()))];
    const countries = await Promise.all(countryIds.map((id) => this.countriesService.findOne(id)));
    const floorByCountryId = new Map(
      countries.map((c) => [
        (c as unknown as { id: string }).id,
        c.walletPolicy.negativeBalanceFloor,
      ]),
    );
    const matches = all
      .filter((w) => w.balance <= (floorByCountryId.get(w.countryId.toString()) ?? -Infinity))
      .sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime());
    const total = matches.length;
    const page = matches.slice(query.skip, query.skip + query.limit);
    return { data: page, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async listEntries(
    workerProfileId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<WalletEntryDocument>> {
    const wallet = await this.getOrCreateWallet(workerProfileId);
    const filter = { walletId: wallet.id };
    const [data, total] = await Promise.all([
      this.entryModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.entryModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  /**
   * The one place a ledger entry is actually written. Idempotent on
   * `idempotencyKey` even under genuine concurrency, WITHOUT a multi-document
   * transaction (this app's local dev Mongo is a standalone instance, not a
   * replica set, so transactions aren't always available — only Atlas
   * guarantees them): the wallet's `$inc` is attempted first, then the entry
   * is inserted under its unique idempotencyKey; if that insert loses a race
   * (code 11000 — someone else's call for the exact same key already landed
   * between our pre-check and here), this call undoes its own `$inc` and
   * hands back the winner's entry instead. The one gap this can't close is a
   * crash in the few milliseconds between the `$inc` and the undo/insert —
   * that would show up as the wallet's cached balance disagreeing with the
   * sum of its entries, which is exactly the drift `npm run wallet:verify`
   * exists to catch and report loudly.
   */
  async recordEntry(params: RecordWalletEntryParams): Promise<RecordWalletEntryResult> {
    const existing = await this.entryModel
      .findOne({ idempotencyKey: params.idempotencyKey })
      .exec();
    if (existing) {
      return { entry: existing, deduped: true };
    }

    const wallet = await this.walletModel
      .findOneAndUpdate(
        { _id: params.walletId },
        { $inc: { balance: params.amount } },
        { new: true },
      )
      .exec();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    try {
      const entry = await this.entryModel.create({
        walletId: params.walletId,
        bookingId: params.bookingId ?? null,
        type: params.type,
        amount: params.amount,
        currency: params.currency,
        balanceAfter: wallet.balance,
        idempotencyKey: params.idempotencyKey,
        createdBy: params.createdBy,
        reversesEntryId: params.reversesEntryId ?? null,
        metadata: params.metadata ?? {},
      });
      return { entry, deduped: false };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        await this.walletModel
          .updateOne({ _id: params.walletId }, { $inc: { balance: -params.amount } })
          .exec();
        const winningEntry = await this.entryModel
          .findOne({ idempotencyKey: params.idempotencyKey })
          .exec();
        if (!winningEntry) {
          throw new ConflictException('Wallet entry idempotency conflict could not be resolved');
        }
        return { entry: winningEntry, deduped: true };
      }
      throw error;
    }
  }

  /** Called from BookingsService.complete() — see that method for the "must not break completion" failure handling. */
  async chargeCommission(
    bookingId: string,
    workerProfileId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const wallet = await this.getOrCreateWallet(workerProfileId);
    const { entry, deduped } = await this.recordEntry({
      walletId: wallet.id as string,
      bookingId,
      type: WalletEntryType.COMMISSION_CHARGE,
      amount: -amount,
      currency,
      idempotencyKey: `commission:${bookingId}`,
      createdBy: null,
    });
    if (deduped) {
      return;
    }
    await this.applySuspensionAndWarningChecks(
      workerProfileId,
      wallet.countryId.toString(),
      entry.balanceAfter as number,
      currency,
    );
  }

  /** Zero by default (Country.walletPolicy.workerCancellationPenaltyAmount) — a no-op until a country enables it. */
  async chargeCancellationPenalty(
    bookingId: string,
    workerProfileId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    if (amount <= 0) {
      return;
    }
    const wallet = await this.getOrCreateWallet(workerProfileId);
    const { entry, deduped } = await this.recordEntry({
      walletId: wallet.id as string,
      bookingId,
      type: WalletEntryType.CANCELLATION_FEE,
      amount: -amount,
      currency,
      idempotencyKey: `cancellation-penalty:${bookingId}`,
      createdBy: null,
    });
    if (deduped) {
      return;
    }
    await this.applySuspensionAndWarningChecks(
      workerProfileId,
      wallet.countryId.toString(),
      entry.balanceAfter as number,
      currency,
    );
  }

  async topup(
    adminUserId: string,
    workerProfileId: string,
    dto: TopupWalletDto,
  ): Promise<WalletEntryDocument> {
    const wallet = await this.getOrCreateWallet(workerProfileId);
    const idempotencyKey = dto.idempotencyKey ?? `topup:${workerProfileId}:${dto.reference}`;

    const { entry, deduped } = await this.recordEntry({
      walletId: wallet.id as string,
      bookingId: null,
      type: WalletEntryType.TOPUP,
      amount: dto.amount,
      currency: wallet.currency,
      idempotencyKey,
      createdBy: adminUserId,
      metadata: { reference: dto.reference, note: dto.note ?? null },
    });
    if (deduped) {
      return entry;
    }

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.WALLET_TOPUP,
      targetType: 'Wallet',
      targetId: wallet.id as string,
      metadata: { amount: dto.amount, reference: dto.reference, entryId: entry.id },
    });

    // Reinstatement is deliberately only ever triggered from a real topup —
    // see FinancialStatus's own doc comment on why an ADJUSTMENT/REVERSAL
    // crossing back above the floor must NOT auto-reinstate.
    await this.applyReinstatementCheck(
      workerProfileId,
      wallet.countryId.toString(),
      entry.balanceAfter as number,
    );

    return entry;
  }

  async adjust(
    adminUserId: string,
    workerProfileId: string,
    dto: AdjustWalletDto,
  ): Promise<WalletEntryDocument> {
    const wallet = await this.getOrCreateWallet(workerProfileId);
    // No natural external key for an admin adjustment — each submission is its own distinct correction.
    const idempotencyKey = `adjustment:${randomUUID()}`;

    const { entry } = await this.recordEntry({
      walletId: wallet.id as string,
      bookingId: null,
      type: WalletEntryType.ADJUSTMENT,
      amount: dto.amount,
      currency: wallet.currency,
      idempotencyKey,
      createdBy: adminUserId,
      metadata: { reason: dto.reason },
    });

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.WALLET_ADJUSTMENT,
      targetType: 'Wallet',
      targetId: wallet.id as string,
      metadata: { amount: dto.amount, reason: dto.reason, entryId: entry.id },
    });

    await this.applySuspensionAndWarningChecks(
      workerProfileId,
      wallet.countryId.toString(),
      entry.balanceAfter as number,
      wallet.currency,
    );

    return entry;
  }

  async reverse(
    adminUserId: string,
    workerProfileId: string,
    dto: ReverseWalletEntryDto,
  ): Promise<WalletEntryDocument> {
    const wallet = await this.getOrCreateWallet(workerProfileId);
    const original = await this.entryModel
      .findOne({ _id: dto.entryId, walletId: wallet.id })
      .exec();
    if (!original) {
      throw new NotFoundException('Wallet entry not found for this worker');
    }
    if (original.type === WalletEntryType.REVERSAL) {
      throw new BadRequestException(
        'Cannot reverse a REVERSAL entry — reverse the original instead',
      );
    }

    // Reversing the exact same entry twice is itself idempotent, deliberately.
    const idempotencyKey = `reversal:${original.id as string}`;

    const { entry, deduped } = await this.recordEntry({
      walletId: wallet.id as string,
      bookingId: original.bookingId ? original.bookingId.toString() : null,
      type: WalletEntryType.REVERSAL,
      amount: -original.amount,
      currency: original.currency,
      idempotencyKey,
      createdBy: adminUserId,
      reversesEntryId: original.id as string,
      metadata: { reason: dto.reason },
    });
    if (deduped) {
      return entry;
    }

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.WALLET_REVERSAL,
      targetType: 'WalletEntry',
      targetId: original.id as string,
      metadata: { reason: dto.reason, reversalEntryId: entry.id },
    });

    await this.applySuspensionAndWarningChecks(
      workerProfileId,
      wallet.countryId.toString(),
      entry.balanceAfter as number,
      wallet.currency,
    );

    return entry;
  }

  /** Admin-only, for disputes — the automatic path is a real topup crossing the floor (see `topup`). */
  async reinstateManually(
    adminUserId: string,
    workerProfileId: string,
    reason: string,
  ): Promise<WorkerProfileDocument> {
    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    if (profile.financialStatus !== FinancialStatus.SUSPENDED) {
      throw new BadRequestException('This worker is not financially suspended');
    }

    profile.financialStatus = FinancialStatus.ACTIVE;
    await profile.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.WALLET_REINSTATED,
      targetType: 'WorkerProfile',
      targetId: workerProfileId,
      metadata: { reason, manual: true },
    });

    const wallet = await this.getOrCreateWallet(workerProfileId);
    await this.notify(
      profile,
      NotificationEventType.WALLET_REINSTATED,
      wallet.balance,
      wallet.currency,
    );

    return profile;
  }

  private async applySuspensionAndWarningChecks(
    workerProfileId: string,
    countryId: string,
    balance: number,
    currency: string,
  ): Promise<void> {
    const country = await this.countriesService.findOne(countryId);
    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    const { negativeBalanceFloor, lowBalanceWarningThreshold } = country.walletPolicy;

    if (balance < negativeBalanceFloor) {
      if (profile.financialStatus === FinancialStatus.ACTIVE) {
        profile.financialStatus = FinancialStatus.SUSPENDED;
        await profile.save();
        await this.notify(profile, NotificationEventType.WALLET_SUSPENDED, balance, currency);
      }
      return;
    }

    if (balance <= lowBalanceWarningThreshold) {
      await this.notify(profile, NotificationEventType.WALLET_LOW_BALANCE, balance, currency);
    }
  }

  /** Only ever called from `topup` — see its own comment on why ADJUSTMENT/REVERSAL never auto-reinstate. */
  private async applyReinstatementCheck(
    workerProfileId: string,
    countryId: string,
    balance: number,
  ): Promise<void> {
    const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
    if (profile.financialStatus !== FinancialStatus.SUSPENDED) {
      return;
    }
    const country = await this.countriesService.findOne(countryId);
    if (balance < country.walletPolicy.negativeBalanceFloor) {
      return; // still below the floor — stays suspended
    }

    profile.financialStatus = FinancialStatus.ACTIVE;
    await profile.save();

    const wallet = await this.getOrCreateWallet(workerProfileId);
    await this.notify(
      profile,
      NotificationEventType.WALLET_REINSTATED,
      wallet.balance,
      wallet.currency,
    );
  }

  /** Never lets a notification failure break the financial operation that triggered it. */
  private async notify(
    profile: WorkerProfileDocument,
    type: NotificationEventType,
    balance: number,
    currency: string,
  ): Promise<void> {
    try {
      await this.notifier.notify({
        type,
        recipientUserId: profile.userId.toString(),
        bookingId: null,
        context: { balance, currency },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send ${type} notification to worker profile ${profile.id}`,
        (error as Error).stack,
      );
    }
  }
}
