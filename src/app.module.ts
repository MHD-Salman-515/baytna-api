import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { envFilePath } from './config/load-env';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DatabaseModule } from './database/database.module';
import { CountriesModule } from './modules/countries/countries.module';
import { CitiesModule } from './modules/cities/cities.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolved from the project root (see load-env.ts), not process.cwd(),
      // and honors ENV_FILE — same resolution the standalone scripts use.
      envFilePath,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.get<number>('throttle.ttl', 60) * 1000,
            limit: configService.get<number>('throttle.limit', 100),
          },
          {
            // Generous global default — a no-op almost everywhere. The route
            // that actually matters (POST /auth/otp/request) tightens this
            // via @Throttle({ otp: { limit, ttl } }), giving OTP requests a
            // stricter per-IP cap layered on top of the 'default' throttler
            // above, without affecting any other route.
            name: 'otp',
            ttl: 60 * 1000,
            limit: 1000,
          },
        ],
      }),
    }),
    // JwtAuthGuard below is a global APP_GUARD, so its JwtService dependency
    // must be resolvable at this module's own level — it can't rely on the
    // JwtModule registered inside AuthModule's TokensModule, since that's
    // never re-exported up. No default secret here either (see TokensModule):
    // both the guard and TokenService always pass an explicit secret.
    JwtModule.register({}),
    DatabaseModule,
    CountriesModule,
    CitiesModule,
    UsersModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
