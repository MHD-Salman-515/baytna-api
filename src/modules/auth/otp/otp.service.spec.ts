import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OTP_SENDER, OTP_STORE } from './otp.constants';
import { OtpRecord } from './otp-store.interface';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  let service: OtpService;
  let store: {
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    incrementAttempts: jest.Mock;
    recordRequestAndCountInWindow: jest.Mock;
  };
  let sender: { send: jest.Mock };

  const phone = '+963911111111';

  beforeEach(async () => {
    store = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      incrementAttempts: jest.fn(),
      recordRequestAndCountInWindow: jest.fn(),
    };
    sender = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: OTP_STORE, useValue: store },
        { provide: OTP_SENDER, useValue: sender },
        { provide: ConfigService, useValue: { get: () => 'test-pepper-0123456789012345678901234' } },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  describe('requestOtp', () => {
    it('generates a 6-digit code, stores its hash, and sends it via the sender', async () => {
      store.get.mockResolvedValue(null);
      store.recordRequestAndCountInWindow.mockResolvedValue(1);

      await service.requestOtp(phone);

      expect(store.set).toHaveBeenCalledTimes(1);
      const [storedPhone, record] = store.set.mock.calls[0] as [string, OtpRecord];
      expect(storedPhone).toBe(phone);
      expect(record.attempts).toBe(0);
      expect(record.codeHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest

      expect(sender.send).toHaveBeenCalledTimes(1);
      const [sentPhone, code] = sender.send.mock.calls[0] as [string, string];
      expect(sentPhone).toBe(phone);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('rejects with 429 during the cooldown window', async () => {
      store.get.mockResolvedValue({
        codeHash: 'x',
        expiresAt: Date.now() + 100_000,
        attempts: 0,
        requestedAt: Date.now() - 5_000, // requested 5s ago, cooldown is 60s
      });

      await expect(service.requestOtp(phone)).rejects.toThrow(HttpException);
      expect(store.set).not.toHaveBeenCalled();
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('allows a new request once the cooldown has elapsed', async () => {
      store.get.mockResolvedValue({
        codeHash: 'x',
        expiresAt: Date.now() - 1,
        attempts: 0,
        requestedAt: Date.now() - 61_000,
      });
      store.recordRequestAndCountInWindow.mockResolvedValue(2);

      await expect(service.requestOtp(phone)).resolves.toBeUndefined();
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('rejects with 429 once the hourly request limit is exceeded', async () => {
      store.get.mockResolvedValue(null);
      store.recordRequestAndCountInWindow.mockResolvedValue(6); // limit is 5

      await expect(service.requestOtp(phone)).rejects.toThrow(HttpException);
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('rejects when no code was ever requested', async () => {
      store.get.mockResolvedValue(null);
      await expect(service.verifyOtp(phone, '123456')).rejects.toThrow(BadRequestException);
    });

    it('rejects and increments attempts on a wrong code', async () => {
      store.get.mockResolvedValue({
        codeHash: 'a'.repeat(64),
        expiresAt: Date.now() + 100_000,
        attempts: 0,
        requestedAt: Date.now(),
      });

      await expect(service.verifyOtp(phone, '000000')).rejects.toThrow(BadRequestException);
      expect(store.incrementAttempts).toHaveBeenCalledWith(phone);
      expect(store.delete).not.toHaveBeenCalled();
    });

    it('rejects and deletes the record once max attempts are already reached', async () => {
      store.get.mockResolvedValue({
        codeHash: 'a'.repeat(64),
        expiresAt: Date.now() + 100_000,
        attempts: 5,
        requestedAt: Date.now(),
      });

      await expect(service.verifyOtp(phone, '000000')).rejects.toThrow(BadRequestException);
      expect(store.delete).toHaveBeenCalledWith(phone);
      expect(store.incrementAttempts).not.toHaveBeenCalled();
    });

    it('accepts the correct code and deletes the record (single-use)', async () => {
      // Capture the real hash the service computes for a known code by
      // requesting first, then verify with that same code.
      store.get.mockResolvedValueOnce(null);
      store.recordRequestAndCountInWindow.mockResolvedValueOnce(1);
      let sentCode = '';
      sender.send.mockImplementationOnce(async (_p: string, c: string) => {
        sentCode = c;
      });
      await service.requestOtp(phone);
      const [, storedRecord] = store.set.mock.calls[0] as [string, OtpRecord];

      store.get.mockResolvedValueOnce(storedRecord);

      await expect(service.verifyOtp(phone, sentCode)).resolves.toBeUndefined();
      expect(store.delete).toHaveBeenCalledWith(phone);
      expect(store.incrementAttempts).not.toHaveBeenCalled();
    });
  });
});
