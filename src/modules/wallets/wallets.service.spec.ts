import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { NotificationEventType } from '../notifications/notification-event';
import { FinancialStatus } from '../workers/schemas/worker-profile.schema';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WalletEntryType } from './schemas/wallet-entry.schema';
import { WalletsService } from './wallets.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('WalletsService', () => {
  let service: WalletsService;
  let walletModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let entryModel: {
    findOne: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let workerProfilesService: {
    getForAdmin: jest.Mock;
    getOwn: jest.Mock;
    listIdsByFinancialStatus: jest.Mock;
  };
  let countriesService: { findOne: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let notifier: { notify: jest.Mock };

  const walletId = 'wallet-1';
  const workerProfileId = 'profile-1';
  const countryId = 'country-1';
  const adminUserId = 'admin-1';

  const country = {
    id: countryId,
    currencyCode: 'SYP',
    walletPolicy: {
      negativeBalanceFloor: -5000,
      lowBalanceWarningThreshold: -2000,
      workerCancellationPenaltyAmount: 0,
    },
  };

  function profile(overrides: Record<string, unknown> = {}) {
    return {
      id: workerProfileId,
      userId: { toString: () => 'worker-user-1' },
      countryId: { toString: () => countryId },
      financialStatus: FinancialStatus.ACTIVE,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function wallet(overrides: Record<string, unknown> = {}) {
    return {
      id: walletId,
      workerProfileId: { toString: () => workerProfileId },
      countryId: { toString: () => countryId },
      balance: 0,
      currency: 'SYP',
      ...overrides,
    };
  }

  beforeEach(() => {
    walletModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(chainExec({})),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    entryModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    workerProfilesService = {
      getForAdmin: jest.fn().mockResolvedValue(profile()),
      getOwn: jest.fn().mockResolvedValue(profile()),
      listIdsByFinancialStatus: jest.fn(),
    };
    countriesService = { findOne: jest.fn().mockResolvedValue(country) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = { get: jest.fn().mockReturnValue(notifier) };

    service = new WalletsService(
      walletModel as never,
      entryModel as never,
      workerProfilesService as unknown as WorkerProfilesService,
      countriesService as unknown as CountriesService,
      auditLogService as unknown as AuditLogService,
      moduleRef as unknown as ModuleRef,
    );
  });

  describe('getOrCreateWallet', () => {
    it('returns the existing wallet without creating one', async () => {
      const existingWallet = wallet();
      walletModel.findOne.mockReturnValue(chainExec(existingWallet));

      const result = await service.getOrCreateWallet(workerProfileId);

      expect(result).toBe(existingWallet);
      expect(walletModel.create).not.toHaveBeenCalled();
    });

    it("creates a zero-balance wallet in the worker's own country/currency when none exists", async () => {
      walletModel.findOne.mockReturnValue(chainExec(null));
      walletModel.create.mockResolvedValue(wallet());

      await service.getOrCreateWallet(workerProfileId);

      expect(walletModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerProfileId, balance: 0, currency: 'SYP' }),
      );
    });

    it("recovers from a creation race by returning the winner's wallet", async () => {
      const winningWallet = wallet();
      walletModel.findOne
        .mockReturnValueOnce(chainExec(null))
        .mockReturnValueOnce(chainExec(winningWallet));
      walletModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

      await expect(service.getOrCreateWallet(workerProfileId)).resolves.toBe(winningWallet);
    });
  });

  describe('recordEntry', () => {
    it('increments the wallet and writes a new entry with the resulting balanceAfter', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: 6000 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: 6000 });

      const { entry, deduped } = await service.recordEntry({
        walletId,
        bookingId: 'booking-1',
        type: WalletEntryType.COMMISSION_CHARGE,
        amount: -900,
        currency: 'SYP',
        idempotencyKey: 'commission:booking-1',
        createdBy: null,
      });

      expect(walletModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: walletId },
        { $inc: { balance: -900 } },
        { new: true },
      );
      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ balanceAfter: 6000, idempotencyKey: 'commission:booking-1' }),
      );
      expect(deduped).toBe(false);
      expect(entry.id).toBe('entry-1');
    });

    it('is idempotent: an already-existing idempotencyKey short-circuits without touching the wallet', async () => {
      entryModel.findOne.mockReturnValue(chainExec({ id: 'existing-entry' }));

      const { entry, deduped } = await service.recordEntry({
        walletId,
        type: WalletEntryType.TOPUP,
        amount: 1000,
        currency: 'SYP',
        idempotencyKey: 'topup:x',
        createdBy: adminUserId,
      });

      expect(walletModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(deduped).toBe(true);
      expect(entry.id).toBe('existing-entry');
    });

    it("is idempotent under a genuine race: compensates its own $inc and returns the winner's entry", async () => {
      entryModel.findOne
        .mockReturnValueOnce(chainExec(null)) // pre-check: nothing yet
        .mockReturnValueOnce(chainExec({ id: 'winning-entry' })); // post-conflict re-fetch
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: 1000 })));
      entryModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

      const { entry, deduped } = await service.recordEntry({
        walletId,
        type: WalletEntryType.TOPUP,
        amount: 1000,
        currency: 'SYP',
        idempotencyKey: 'topup:x',
        createdBy: adminUserId,
      });

      expect(walletModel.updateOne).toHaveBeenCalledWith(
        { _id: walletId },
        { $inc: { balance: -1000 } },
      );
      expect(deduped).toBe(true);
      expect(entry.id).toBe('winning-entry');
    });

    it('throws if the idempotency conflict cannot be resolved (the winner vanished)', async () => {
      entryModel.findOne.mockReturnValueOnce(chainExec(null)).mockReturnValueOnce(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: 1000 })));
      entryModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

      await expect(
        service.recordEntry({
          walletId,
          type: WalletEntryType.TOPUP,
          amount: 1000,
          currency: 'SYP',
          idempotencyKey: 'topup:x',
          createdBy: adminUserId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the wallet does not exist', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(null));

      await expect(
        service.recordEntry({
          walletId,
          type: WalletEntryType.TOPUP,
          amount: 1000,
          currency: 'SYP',
          idempotencyKey: 'topup:x',
          createdBy: adminUserId,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('chargeCommission', () => {
    beforeEach(() => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
    });

    it('charges a negative COMMISSION_CHARGE keyed by booking id', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -900 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -900 });

      await service.chargeCommission('booking-1', workerProfileId, 900, 'SYP');

      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WalletEntryType.COMMISSION_CHARGE,
          amount: -900,
          idempotencyKey: 'commission:booking-1',
          bookingId: 'booking-1',
        }),
      );
    });

    it('auto-suspends once the charge pushes the balance below the floor', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -5500 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -5500 });
      const suspendableProfile = profile();
      workerProfilesService.getForAdmin.mockResolvedValue(suspendableProfile);

      await service.chargeCommission('booking-1', workerProfileId, 900, 'SYP');

      expect(suspendableProfile.financialStatus).toBe(FinancialStatus.SUSPENDED);
      expect(suspendableProfile.save).toHaveBeenCalled();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.WALLET_SUSPENDED,
          recipientUserId: 'worker-user-1',
          bookingId: null,
          context: { balance: -5500, currency: 'SYP' },
        }),
      );
    });

    it('never re-suspends (or re-notifies) a worker who is already suspended', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -6000 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -6000 });
      const alreadySuspended = profile({ financialStatus: FinancialStatus.SUSPENDED });
      workerProfilesService.getForAdmin.mockResolvedValue(alreadySuspended);

      await service.chargeCommission('booking-1', workerProfileId, 900, 'SYP');

      expect(alreadySuspended.save).not.toHaveBeenCalled();
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('sends a low-balance warning when crossing the warning threshold but staying above the floor', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -2500 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -2500 });

      await service.chargeCommission('booking-1', workerProfileId, 900, 'SYP');

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.WALLET_LOW_BALANCE }),
      );
    });

    it('is a true no-op on a deduped replay — no second suspension check, no double charge', async () => {
      entryModel.findOne.mockReturnValue(chainExec({ id: 'existing', balanceAfter: -5500 }));

      await service.chargeCommission('booking-1', workerProfileId, 900, 'SYP');

      expect(walletModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(workerProfilesService.getForAdmin).not.toHaveBeenCalled();
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('chargeCancellationPenalty', () => {
    it('is a no-op when the amount is zero (the country default)', async () => {
      await service.chargeCancellationPenalty('booking-1', workerProfileId, 0, 'SYP');

      expect(walletModel.findOne).not.toHaveBeenCalled();
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    it('charges a CANCELLATION_FEE when the country has a configured penalty', async () => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -1000 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -1000 });

      await service.chargeCancellationPenalty('booking-1', workerProfileId, 1000, 'SYP');

      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WalletEntryType.CANCELLATION_FEE,
          amount: -1000,
          idempotencyKey: 'cancellation-penalty:booking-1',
        }),
      );
    });
  });

  describe('topup', () => {
    beforeEach(() => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
    });

    it('credits the wallet, writes an audit log entry, and derives an idempotency key from the reference', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: 10000 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: 10000 });

      await service.topup(adminUserId, workerProfileId, {
        amount: 10000,
        reference: 'RCPT-1',
      });

      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WalletEntryType.TOPUP,
          amount: 10000,
          idempotencyKey: `topup:${workerProfileId}:RCPT-1`,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: adminUserId, action: AuditAction.WALLET_TOPUP }),
      );
    });

    it('auto-reinstates a suspended worker once the topup brings her back above the floor', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -1000 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -1000 });
      const suspended = profile({ financialStatus: FinancialStatus.SUSPENDED });
      workerProfilesService.getForAdmin.mockResolvedValue(suspended);

      await service.topup(adminUserId, workerProfileId, { amount: 10000, reference: 'RCPT-1' });

      expect(suspended.financialStatus).toBe(FinancialStatus.ACTIVE);
      expect(suspended.save).toHaveBeenCalled();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.WALLET_REINSTATED }),
      );
    });

    it('does not reinstate when the topup leaves her still below the floor', async () => {
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -5500 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -5500 });
      const suspended = profile({ financialStatus: FinancialStatus.SUSPENDED });
      workerProfilesService.getForAdmin.mockResolvedValue(suspended);

      await service.topup(adminUserId, workerProfileId, { amount: 500, reference: 'RCPT-1' });

      expect(suspended.financialStatus).toBe(FinancialStatus.SUSPENDED);
      expect(suspended.save).not.toHaveBeenCalled();
    });

    it('skips the audit log and the reinstatement check entirely on a deduped replay', async () => {
      entryModel.findOne.mockReturnValue(chainExec({ id: 'existing', balanceAfter: 10000 }));

      await service.topup(adminUserId, workerProfileId, { amount: 10000, reference: 'RCPT-1' });

      expect(auditLogService.record).not.toHaveBeenCalled();
      expect(workerProfilesService.getForAdmin).not.toHaveBeenCalled();
    });
  });

  describe('adjust', () => {
    it('writes a signed ADJUSTMENT entry with a random (non-deterministic) idempotency key and audit-logs it', async () => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
      entryModel.findOne.mockReturnValue(chainExec(null));
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: -500 })));
      entryModel.create.mockResolvedValue({ id: 'entry-1', balanceAfter: -500 });

      await service.adjust(adminUserId, workerProfileId, {
        amount: -500,
        reason: 'Correcting a duplicate charge',
      });

      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: WalletEntryType.ADJUSTMENT, amount: -500 }),
      );
      const [createCall] = entryModel.create.mock.calls[0] as [{ idempotencyKey: string }];
      expect(createCall.idempotencyKey).toMatch(/^adjustment:/);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.WALLET_ADJUSTMENT }),
      );
    });
  });

  describe('reverse', () => {
    const originalEntry = {
      id: 'original-entry',
      type: WalletEntryType.COMMISSION_CHARGE,
      amount: -900,
      currency: 'SYP',
      bookingId: { toString: () => 'booking-1' },
    };

    beforeEach(() => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
    });

    it('writes a REVERSAL with the exact inverse amount, referencing the original entry', async () => {
      entryModel.findOne
        .mockReturnValueOnce(chainExec(originalEntry)) // the lookup-by-id-and-wallet
        .mockReturnValueOnce(chainExec(null)); // recordEntry's own idempotency pre-check
      walletModel.findOneAndUpdate.mockReturnValue(chainExec(wallet({ balance: 900 })));
      entryModel.create.mockResolvedValue({ id: 'reversal-entry', balanceAfter: 900 });

      await service.reverse(adminUserId, workerProfileId, {
        entryId: 'original-entry',
        reason: 'Charged against the wrong booking',
      });

      expect(entryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WalletEntryType.REVERSAL,
          amount: 900,
          reversesEntryId: 'original-entry',
          idempotencyKey: 'reversal:original-entry',
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.WALLET_REVERSAL }),
      );
    });

    it('throws NotFoundException when the entry does not belong to this wallet', async () => {
      entryModel.findOne.mockReturnValueOnce(chainExec(null));

      await expect(
        service.reverse(adminUserId, workerProfileId, { entryId: 'nope', reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to reverse a REVERSAL entry', async () => {
      entryModel.findOne.mockReturnValueOnce(
        chainExec({ ...originalEntry, type: WalletEntryType.REVERSAL }),
      );

      await expect(
        service.reverse(adminUserId, workerProfileId, { entryId: 'original-entry', reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reversing the same entry twice is idempotent', async () => {
      entryModel.findOne
        .mockReturnValueOnce(chainExec(originalEntry))
        .mockReturnValueOnce(chainExec({ id: 'reversal-entry', balanceAfter: 900 }));

      const result = await service.reverse(adminUserId, workerProfileId, {
        entryId: 'original-entry',
        reason: 'x',
      });

      expect(walletModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result.id).toBe('reversal-entry');
    });
  });

  describe('reinstateManually', () => {
    it('throws when the worker is not currently financially suspended', async () => {
      workerProfilesService.getForAdmin.mockResolvedValue(profile());

      await expect(
        service.reinstateManually(adminUserId, workerProfileId, 'Dispute resolved'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reinstates, audit-logs with manual:true, and notifies', async () => {
      const suspended = profile({ financialStatus: FinancialStatus.SUSPENDED });
      workerProfilesService.getForAdmin.mockResolvedValue(suspended);
      walletModel.findOne.mockReturnValue(chainExec(wallet({ balance: -1000 })));

      await service.reinstateManually(adminUserId, workerProfileId, 'Dispute resolved');

      expect(suspended.financialStatus).toBe(FinancialStatus.ACTIVE);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.WALLET_REINSTATED,
          metadata: expect.objectContaining({ manual: true }),
        }),
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEventType.WALLET_REINSTATED }),
      );
    });
  });

  describe('listForAdmin', () => {
    it('filters by financial status via WorkerProfilesService', async () => {
      workerProfilesService.listIdsByFinancialStatus.mockResolvedValue(['profile-9']);
      walletModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue(chainExec([])) }),
        }),
      });
      walletModel.countDocuments.mockReturnValue(chainExec(0));

      await service.listForAdmin({
        status: FinancialStatus.SUSPENDED,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(workerProfilesService.listIdsByFinancialStatus).toHaveBeenCalledWith(
        FinancialStatus.SUSPENDED,
      );
      expect(walletModel.find).toHaveBeenCalledWith({ workerProfileId: { $in: ['profile-9'] } });
    });

    it("filters low-balance wallets relative to each one's own country floor", async () => {
      walletModel.find.mockReturnValue(
        chainExec([
          wallet({
            id: 'w1',
            balance: -6000,
            countryId: { toString: () => 'country-1' },
            updatedAt: new Date(2),
          }),
          wallet({
            id: 'w2',
            balance: -100,
            countryId: { toString: () => 'country-1' },
            updatedAt: new Date(1),
          }),
        ]),
      );
      countriesService.findOne.mockResolvedValue(country); // floor -5000

      const result = await service.listForAdmin({
        lowBalance: true,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as unknown as { id: string }).id).toBe('w1');
    });
  });

  describe('listEntries', () => {
    it("paginates a wallet's own entries", async () => {
      walletModel.findOne.mockReturnValue(chainExec(wallet()));
      walletModel.find.mockReturnValue(chainExec([])); // unused branch guard
      entryModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue(chainExec([])) }),
        }),
      });
      entryModel.countDocuments.mockReturnValue(chainExec(0));

      await service.listEntries(workerProfileId, { page: 1, limit: 20, skip: 0 } as never);

      expect(entryModel.find).toHaveBeenCalledWith({ walletId });
    });
  });
});
