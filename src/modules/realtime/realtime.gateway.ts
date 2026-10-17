import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { BookingsService } from '../bookings/bookings.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { authenticateSocket } from './socket-auth';
import { bookingRoom, userRoom } from './rooms';

export interface AuthenticatedSocket extends Socket {
  user?: AuthenticatedUser;
}

const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? '*').split(',').map((o) => o.trim());

/**
 * Authoritative delivery channel while the app is open; push (FCM) and
 * polling remain the fallback paths, so nothing here is the only source of
 * truth for any event. Connection auth and per-booking-room join
 * authorization both run JwtAuthGuard-equivalent / isPartyToBooking checks —
 * a socket connecting does NOT, by itself, change any booking eligibility.
 */
@WebSocketGateway({
  cors: { origin: configuredCorsOrigins.includes('*') ? true : configuredCorsOrigins },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly bookingsService: BookingsService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const user = await authenticateSocket(socket, this.jwtService, this.configService);
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.user = user;
    await socket.join(userRoom(user.userId));
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    this.logger.debug(`socket disconnected: ${socket.id}`);
  }

  /** Authorization is checked on every join, not just once at connection time. */
  @SubscribeMessage('booking:join')
  async handleBookingJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { bookingId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!socket.user || !data?.bookingId) {
      return { ok: false, error: 'forbidden' };
    }
    const allowed = await this.bookingsService.isPartyToBooking(socket.user.userId, data.bookingId);
    if (!allowed) {
      return { ok: false, error: 'forbidden' };
    }
    await socket.join(bookingRoom(data.bookingId));
    return { ok: true };
  }

  @SubscribeMessage('booking:leave')
  async handleBookingLeave(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { bookingId?: string },
  ): Promise<{ ok: boolean }> {
    if (data?.bookingId) {
      await socket.leave(bookingRoom(data.bookingId));
    }
    return { ok: true };
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  emitToBooking(bookingId: string, event: string, payload: unknown): void {
    this.server.to(bookingRoom(bookingId)).emit(event, payload);
  }
}
