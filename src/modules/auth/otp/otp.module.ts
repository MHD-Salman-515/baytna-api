import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleOtpSender } from './console-otp-sender';
import { InMemoryOtpStore } from './in-memory-otp-store';
import { OTP_SENDER, OTP_STORE } from './otp.constants';
import { OtpService } from './otp.service';
import { OtpSender } from './otp-sender.interface';
import { OtpStore } from './otp-store.interface';
import { RedisOtpStore } from './redis-otp-store';

@Module({
  providers: [
    {
      provide: OTP_SENDER,
      useFactory: (configService: ConfigService): OtpSender => {
        if (configService.get<string>('nodeEnv') === 'production') {
          throw new Error(
            'No production OtpSender is configured. ConsoleOtpSender must never run in production ' +
              '(it logs codes instead of sending them) — implement a real SMS/WhatsApp OtpSender and ' +
              'wire it in here before deploying.',
          );
        }
        return new ConsoleOtpSender();
      },
      inject: [ConfigService],
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
