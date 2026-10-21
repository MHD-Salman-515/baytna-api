import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { WalletsService } from '../wallets/wallets.service';
import { CommissionChargeRetrySweepService } from './commission-charge-retry-sweep.service';
import { Booking } from './schemas/booking.schema';

function chainable(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('CommissionChargeRetrySweepService', () => {
  let service: CommissionChargeRetrySweepService;
  let bookingModel: { find: jest.Mock; updateOne: jest.Mock };
  let walletsService: { chargeCommission: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };

  function unchargedBooking(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'booking-1',
      id: 'booking-1',
      workerProfileId: { toString: () => 'worker-profile-1' },
      finalPricing: { commissionAmount: 900, currency: 'SYP' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    bookingModel = { find: jest.fn(), updateOne: jest.fn() };
    walletsService = { chargeCommission: jest.fn().mockResolvedValue(undefined) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue(true) };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };

    bookingModel.find.mockReturnValue(chainable([]));
    bookingModel.updateOne.mockReturnValue(chainable({ modifiedCount: 1 }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionChargeRetrySweepService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: WalletsService, useValue: walletsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(CommissionChargeRetrySweepService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    it('queries COMPLETED bookings with no commissionChargedAt', async () => {
      await service.sweep();

      expect(bookingModel.find).toHaveBeenCalledWith({
        status: 'COMPLETED',
        commissionChargedAt: null,
      });
    });

    it('retries the charge and stamps commissionChargedAt on success', async () => {
      const booking = unchargedBooking();
      bookingModel.find.mockReturnValue(chainable([booking]));

      const charged = await service.sweep();

      expect(walletsService.chargeCommission).toHaveBeenCalledWith(
        'booking-1',
        'worker-profile-1',
        900,
        'SYP',
      );
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'booking-1' },
        { commissionChargedAt: expect.any(Date) },
      );
      expect(charged).toBe(1);
    });

    it('audit-logs a repeated failure, marked as a retry, and leaves commissionChargedAt untouched', async () => {
      bookingModel.find.mockReturnValue(chainable([unchargedBooking()]));
      walletsService.chargeCommission.mockRejectedValue(new Error('still unreachable'));

      const charged = await service.sweep();

      expect(bookingModel.updateOne).not.toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: null,
          action: AuditAction.WALLET_COMMISSION_CHARGE_FAILED,
          targetType: 'Booking',
          targetId: 'booking-1',
          metadata: expect.objectContaining({ retry: true }),
        }),
      );
      expect(charged).toBe(0);
    });

    it('keeps processing the rest of the batch after one booking fails', async () => {
      const failing = unchargedBooking({ _id: 'booking-1', id: 'booking-1' });
      const succeeding = unchargedBooking({ _id: 'booking-2', id: 'booking-2' });
      bookingModel.find.mockReturnValue(chainable([failing, succeeding]));
      walletsService.chargeCommission
        .mockRejectedValueOnce(new Error('still unreachable'))
        .mockResolvedValueOnce(undefined);

      const charged = await service.sweep();

      expect(charged).toBe(1);
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'booking-2' },
        { commissionChargedAt: expect.any(Date) },
      );
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled', () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'wallet.commissionChargeRetrySweepEnabled' ? false : fallback,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'wallet.commissionChargeRetrySweepEnabled') return true;
        if (key === 'wallet.commissionChargeRetrySweepIntervalSeconds') return 300;
        return fallback;
      });

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'commission-charge-retry-sweep',
        expect.anything(),
      );
    });
  });
});
