import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { AuthService } from './auth.service';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OTP_IP_THROTTLE_LIMIT, OTP_IP_THROTTLE_TTL_MS } from './otp/otp.constants';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  @Public()
  // Stricter, IP-scoped limit on top of the global throttler — the 'otp'
  // throttler is registered with a generous default in app.module.ts so it's
  // a no-op everywhere else; this override is what actually bites.
  // Configurable via OTP_IP_THROTTLE_LIMIT/OTP_IP_THROTTLE_TTL_MS — see
  // otp.constants.ts for why a decorator reads process.env directly instead
  // of going through ConfigService.
  @Throttle({ otp: { limit: OTP_IP_THROTTLE_LIMIT, ttl: OTP_IP_THROTTLE_TTL_MS } })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto): Promise<{ message: string }> {
    await this.authService.requestOtp(dto);
    return { message: 'If this number is valid, a verification code has been sent.' };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Public from the access-token guard's perspective: the refresh token
  // itself (verified inside AuthService) is the proof of ownership — an
  // expired 15-minute access token shouldn't block logging out.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
    // Deactivation is keyed by the token value alone (see
    // DeviceTokensService.deactivateToken) — no need to resolve "who" from
    // the refresh token just to unregister this one device's push token.
    if (dto.deviceToken) {
      await this.deviceTokensService.deactivateToken(dto.deviceToken);
    }
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logoutAll(user.userId);
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }
}
