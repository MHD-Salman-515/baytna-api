import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DevOtpController } from './dev-otp.controller';
import { InMemoryOtpStore } from './in-memory-otp-store';
import { OTP_SENDER, OTP_STORE } from './otp.constants';
import { OtpService } from './otp.service';
import { OtpSender } from './otp-sender.interface';
import { OtpStore } from './otp-store.interface';
import { RedisOtpStore } from './redis-otp-store';
import { DevOtpCode, DevOtpCodeDocument, DevOtpCodeSchema } from './schemas/dev-otp-code.schema';
import { StoredOtpSender } from './stored-otp-sender';

@Module({
  imports: [MongooseModule.forFeature([{ name: DevOtpCode.name, schema: DevOtpCodeSchema }])],
  controllers: [DevOtpController],
  providers: [
    {
      provide: OTP_SENDER,
      useFactory: (
        configService: ConfigService,
        devOtpCodeModel: Model<DevOtpCodeDocument>,
      ): OtpSender => {
        if (configService.get<string>('nodeEnv') === 'production') {
          throw new Error(
            'No production OtpSender is configured. StoredOtpSender must never run in production ' +
              '(it logs codes AND persists them in the clear) — implement a real SMS/WhatsApp ' +
              'OtpSender and wire it in here before deploying.',
          );
        }
        return new StoredOtpSender(devOtpCodeModel);
      },
      inject: [ConfigService, getModelToken(DevOtpCode.name)],
    },
    {
      provide: OTP_STORE,
      useFactory: (configService: ConfigService): OtpStore => {
        const redisUrl = configService.get<string>('redisUrl');
        return redisUrl ? new RedisOtpStore(redisUrl) : new InMemoryOtpStore();
      },
      inject: [ConfigService],
    },
    OtpService,
  ],
  exports: [OtpService],
})
export class OtpModule {}
