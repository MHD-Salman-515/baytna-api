import { ForbiddenException, Injectable } from '@nestjs/common';
import { PhoneValidationService } from '../users/phone-validation.service';
import { UserDocument, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp/otp.service';
import { TokenPair, TokenService } from './tokens/token.service';

export interface VerifyOtpResult extends TokenPair {
  isNewUser: boolean;
  user: UserDocument;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly phoneValidationService: PhoneValidationService,
    private readonly otpService: OtpService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * No return value on purpose: the response must not reveal whether this
   * phone is already registered (no user enumeration) — success looks
   * identical whether a code was actually delivered to a real, new, or
   * suspended account.
   */
  async requestOtp(dto: RequestOtpDto): Promise<void> {
    const { e164 } = await this.phoneValidationService.normalizeForCountry(
      dto.phone,
      dto.countryId,
    );
    await this.otpService.requestOtp(e164);
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<VerifyOtpResult> {
    const { e164, country } = await this.phoneValidationService.normalizeForCountry(
      dto.phone,
      dto.countryId,
    );
    await this.otpService.verifyOtp(e164, dto.code);

    const { user, isNewUser } = await this.usersService.findOrCreateByPhone(
      e164,
      country.id as string,
    );

    // Unlike the anti-enumeration stance on requestOtp, this IS meaningful
    // information to return here — the caller just proved phone ownership by
    // supplying a valid one-time code, so revealing their own account state
    // isn't an enumeration risk.
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is suspended');
    }

    // recordLogin persists lastLoginAt via a separate updateOne (see
    // UsersService) — mirror it onto this in-memory doc too, or the response
    // below would echo the stale pre-login value instead of what we just wrote.
    await this.usersService.recordLogin(user.id as string);
    user.lastLoginAt = new Date();

    const tokens = await this.tokenService.issueTokenPair({
      id: user.id as string,
      roles: user.roles,
    });

    return { ...tokens, isNewUser, user };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokenService.rotateRefreshToken(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeByToken(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<UserDocument> {
    return this.usersService.findById(userId);
  }
}
