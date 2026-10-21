import { Controller, Get, Headers, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import { Public } from '../../../common/decorators/public.decorator';
import { DevOtpCode, DevOtpCodeDocument } from './schemas/dev-otp-code.schema';

const DEV_OTP_KEY_HEADER = 'x-dev-otp-key';

/**
 * STAGING/DEV ONLY. Exists because Render's free tier doesn't expose live
 * log streaming, so ConsoleOtpSender's output (now StoredOtpSender's) is
 * otherwise unreachable during manual QA. Refuses to even construct in
 * production — see the constructor check below — so this route is
 * structurally absent from a production deployment, not just "disabled".
 */
@Public()
@Controller('dev')
export class DevOtpController {
  constructor(
    @InjectModel(DevOtpCode.name) private readonly model: Model<DevOtpCodeDocument>,
    private readonly configService: ConfigService,
  ) {
    if (this.configService.get<string>('nodeEnv') === 'production') {
      throw new Error(
        'DevOtpController must never be wired up in production — it exists solely for staging QA.',
      );
    }
  }

  /**
   * Same 404 whether the key is missing/wrong, the phone is missing, or no
   * unexpired/unconsumed code exists for it — a caller must never be able
   * to distinguish "bad key" from "no such code" from the response alone.
   */
  @Get('last-otp')
  async getLastOtp(
    @Headers(DEV_OTP_KEY_HEADER) providedKey: string | undefined,
    @Query('phone') phone?: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const expectedKey = this.configService.get<string>('devOtpAccessKey');
    if (!expectedKey || !phone || !this.isValidKey(providedKey, expectedKey)) {
      throw new NotFoundException();
    }

    const record = await this.model
      .findOne({ phone, consumed: false, expiresAt: { $gt: new Date() } })
      .exec();
    if (!record) {
      throw new NotFoundException();
    }

    return { code: record.code, expiresAt: record.expiresAt };
  }

  private isValidKey(provided: string | undefined, expected: string): boolean {
    if (!provided) {
      return false;
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  }
}
