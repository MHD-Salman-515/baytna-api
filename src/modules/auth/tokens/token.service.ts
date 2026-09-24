import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { Role } from '../../../common/enums/role.enum';
import { UserStatus } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { RefreshToken, RefreshTokenDocument, RefreshTokenStatus } from './refresh-token.schema';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshTokenPayload {
  sub: string;
  familyId: string;
  jti: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @InjectModel(RefreshToken.name) private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  /** Issues a fresh access+refresh pair. Pass `familyId` when rotating an existing session; omit it to start a new one (login). */
  async issueTokenPair(user: { id: string; roles: Role[] }, familyId?: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, roles: user.roles },
      { secret: this.configService.get<string>('jwtAccessSecret'), expiresIn: ACCESS_TOKEN_TTL },
    );

    const resolvedFamilyId = familyId ?? randomUUID();
    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, familyId: resolvedFamilyId, jti },
      { secret: this.configService.get<string>('jwtRefreshSecret'), expiresIn: REFRESH_TOKEN_TTL },
    );

    await this.refreshTokenModel.create({
      userId: user.id,
      familyId: resolvedFamilyId,
      jti,
      tokenHash: this.hashToken(refreshToken),
      status: RefreshTokenStatus.ACTIVE,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Verifies, rotates, and re-issues from a refresh token. Throws
   * UnauthorizedException for any invalid/expired/unknown/revoked token, an
   * inactive user, or — the important case — reuse of an already-rotated
   * token, which revokes the *entire* token family (see below).
   */
  async rotateRefreshToken(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const record = await this.refreshTokenModel.findOne({ jti: payload.jti }).exec();
    if (!record) {
      throw new UnauthorizedException('Unknown refresh token');
    }

    if (record.status !== RefreshTokenStatus.ACTIVE) {
      // A token that's already been rotated (or revoked) is being presented
      // again. That only happens if it leaked and is now held by two parties
      // — the legitimate client already moved on to its rotated successor,
      // so this presenter isn't it. Burn the whole lineage, not just this token.
      await this.refreshTokenModel
        .updateMany(
          { familyId: record.familyId, status: { $ne: RefreshTokenStatus.REVOKED } },
          { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
        )
        .exec();
      this.logger.warn(`Refresh token reuse detected — revoked family ${record.familyId} (user ${record.userId})`);
      throw new UnauthorizedException('Session revoked due to detected token reuse');
    }

    const user = await this.usersService.findById(record.userId.toString()).catch(() => null);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    record.status = RefreshTokenStatus.ROTATED;
    await record.save();

    return this.issueTokenPair({ id: user.id as string, roles: user.roles }, record.familyId);
  }

  /** Revokes the single session identified by this refresh token (logout). Silently no-ops on an already-invalid token. */
  async revokeByToken(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(refreshToken);
    } catch {
      return;
    }
    await this.refreshTokenModel
      .updateOne({ jti: payload.jti }, { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() })
      .exec();
  }

  /** Revokes every session for a user, across all families (logout-all). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenModel
      .updateMany(
        { userId, status: { $ne: RefreshTokenStatus.REVOKED } },
        { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      )
      .exec();
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.configService.get<string>('jwtRefreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
