import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../../users/users.module';
import { RefreshToken, RefreshTokenSchema } from './refresh-token.schema';
import { TokenService } from './token.service';

@Module({
  imports: [
    // No default secret registered here on purpose: access and refresh tokens
    // use different secrets, passed explicitly on every sign/verify call
    // (TokenService, JwtAuthGuard) rather than relying on one module-wide default.
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
    UsersModule,
  ],
  providers: [TokenService],
  exports: [TokenService, JwtModule],
})
export class TokensModule {}
