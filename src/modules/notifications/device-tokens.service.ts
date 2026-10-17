import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { DeviceToken, DeviceTokenDocument } from './schemas/device-token.schema';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(
    @InjectModel(DeviceToken.name) private readonly tokenModel: Model<DeviceTokenDocument>,
  ) {}

  /**
   * Upserts by `token` alone, not by (userId, token) — a real push token
   * identifies one install, which may change hands (reinstall under a
   * different account) or be re-registered by the same user; either way
   * the single row for that token should just reflect the latest truth.
   * Also how "refresh" works: it's the exact same operation.
   */
  async register(userId: string, dto: RegisterDeviceTokenDto): Promise<DeviceTokenDocument> {
    const doc = await this.tokenModel
      .findOneAndUpdate(
        { token: dto.token, isDeleted: false },
        {
          userId,
          token: dto.token,
          platform: dto.platform,
          appVersion: dto.appVersion ?? null,
          locale: dto.locale,
          lastSeenAt: new Date(),
          isActive: true,
        },
        { upsert: true, new: true },
      )
      .exec();
    return doc as DeviceTokenDocument;
  }

  /** Scoped to her own token — she can only unregister a token she actually holds. */
  async unregister(userId: string, token: string): Promise<void> {
    await this.tokenModel
      .updateOne({ token, userId, isDeleted: false }, { isActive: false })
      .exec();
  }

  /**
   * NOT scoped by user — called by FcmNotifier when FCM itself reports a
   * token as unregistered/invalid, so it stops being retried regardless of
   * whose token it was. Never logs the token value in full (see the class
   * doc on DeviceToken — device tokens are credentials).
   */
  async deactivateToken(token: string): Promise<void> {
    const result = await this.tokenModel
      .updateOne({ token, isDeleted: false }, { isActive: false })
      .exec();
    if (result.modifiedCount > 0) {
      this.logger.log(`Deactivated an invalid/unregistered device token (…${token.slice(-6)})`);
    }
  }

  async listActiveForUser(userId: string): Promise<DeviceTokenDocument[]> {
    return this.tokenModel.find({ userId, isActive: true, isDeleted: false }).exec();
  }
}
