import { StoredOtpSender } from './stored-otp-sender';
import { OTP_TTL_MS } from './otp.constants';

describe('StoredOtpSender', () => {
  let model: { findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
  let sender: StoredOtpSender;

  beforeEach(() => {
    model = {
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    sender = new StoredOtpSender(model as never);
  });

  describe('send', () => {
    it('upserts by phone with the plaintext code, createdAt/expiresAt, and consumed reset to false', async () => {
      const before = Date.now();
      await sender.send('+963911111111', '123456');

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: '+963911111111' },
        expect.objectContaining({
          phone: '+963911111111',
          code: '123456',
          consumed: false,
        }),
        { upsert: true },
      );
      const [, update] = model.findOneAndUpdate.mock.calls[0] as [
        unknown,
        { createdAt: Date; expiresAt: Date },
      ];
      expect(update.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(update.expiresAt.getTime() - update.createdAt.getTime()).toBe(OTP_TTL_MS);
    });

    it('overwrites any previous code for the same phone rather than accumulating rows', async () => {
      await sender.send('+963911111111', '111111');
      await sender.send('+963911111111', '222222');

      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(model.findOneAndUpdate.mock.calls[1][0]).toEqual({ phone: '+963911111111' });
    });
  });

  describe('markConsumed', () => {
    it('flips consumed to true for that phone', async () => {
      await sender.markConsumed('+963911111111');

      expect(model.updateOne).toHaveBeenCalledWith({ phone: '+963911111111' }, { consumed: true });
    });
  });
});
