import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DevOtpController } from './dev-otp.controller';

describe('DevOtpController', () => {
  const ACCESS_KEY = 'a-long-random-dev-only-access-key-value';
  let model: { findOne: jest.Mock };
  let configService: { get: jest.Mock };

  function build(key: string | undefined): DevOtpController {
    configService = {
      get: jest.fn().mockImplementation((k: string) => {
        if (k === 'nodeEnv') return 'development';
        if (k === 'devOtpAccessKey') return key;
        return undefined;
      }),
    };
    model = { findOne: jest.fn() };
    return new DevOtpController(model as never, configService as unknown as ConfigService);
  }

  describe('constructor', () => {
    it('refuses to construct in production, regardless of whether a key is configured', () => {
      configService = {
        get: jest
          .fn()
          .mockImplementation((k: string) => (k === 'nodeEnv' ? 'production' : ACCESS_KEY)),
      };
      expect(
        () => new DevOtpController({} as never, configService as unknown as ConfigService),
      ).toThrow(/never be wired up in production/);
    });

    it('constructs fine outside production', () => {
      expect(() => build(ACCESS_KEY)).not.toThrow();
    });
  });

  describe('getLastOtp', () => {
    it('404s when no access key is configured at all', async () => {
      const controller = build(undefined);
      await expect(controller.getLastOtp(ACCESS_KEY, '+963911111111')).rejects.toThrow(
        NotFoundException,
      );
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('404s when the provided key is missing', async () => {
      const controller = build(ACCESS_KEY);
      await expect(controller.getLastOtp(undefined, '+963911111111')).rejects.toThrow(
        NotFoundException,
      );
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('404s when the provided key is wrong', async () => {
      const controller = build(ACCESS_KEY);
      await expect(controller.getLastOtp('totally-wrong-key', '+963911111111')).rejects.toThrow(
        NotFoundException,
      );
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('404s when the provided key has a different length (constant-time path still rejects)', async () => {
      const controller = build(ACCESS_KEY);
      await expect(controller.getLastOtp('short', '+963911111111')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when phone is missing, even with a valid key', async () => {
      const controller = build(ACCESS_KEY);
      await expect(controller.getLastOtp(ACCESS_KEY, undefined)).rejects.toThrow(NotFoundException);
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('404s when no unexpired, unconsumed record exists for that phone', async () => {
      const controller = build(ACCESS_KEY);
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(controller.getLastOtp(ACCESS_KEY, '+963911111111')).rejects.toThrow(
        NotFoundException,
      );
      expect(model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+963911111111', consumed: false }),
      );
    });

    it('returns the code and expiry when the key is valid and a live record exists', async () => {
      const controller = build(ACCESS_KEY);
      const expiresAt = new Date(Date.now() + 60_000);
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ code: '654321', expiresAt }),
      });

      const result = await controller.getLastOtp(ACCESS_KEY, '+963911111111');

      expect(result).toEqual({ code: '654321', expiresAt });
    });
  });
});
