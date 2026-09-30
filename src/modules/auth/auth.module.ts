import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpModule } from './otp/otp.module';
import { TokensModule } from './tokens/tokens.module';

@Module({
  imports: [UsersModule, OtpModule, TokensModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
