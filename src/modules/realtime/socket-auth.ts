import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

interface AccessTokenPayload {
  sub: string;
  roles: AuthenticatedUser['roles'];
}

/**
 * Mirrors JwtAuthGuard's verification exactly — same secret, same payload
 * shape — so a socket connection is authenticated the same way as an HTTP
 * request. Returns null rather than throwing; the caller (handleConnection)
 * decides that means dropping the connection.
 */
export async function authenticateSocket(
  socket: Socket,
  jwtService: JwtService,
  configService: ConfigService,
): Promise<AuthenticatedUser | null> {
  const token = extractToken(socket);
  if (!token) {
    return null;
  }
  try {
    const payload = await jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: configService.get<string>('jwtAccessSecret'),
    });
    return { userId: payload.sub, roles: payload.roles };
  } catch {
    return null;
  }
}

function extractToken(socket: Socket): string | undefined {
  const fromAuth = socket.handshake.auth?.token as string | undefined;
  if (fromAuth) {
    return fromAuth;
  }
  const header = socket.handshake.headers.authorization;
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' ? token : undefined;
}
