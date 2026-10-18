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
import { LocationTrackingService } from '../bookings/location-tracking.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GeoPoint } from '../cities/schemas/city.schema';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
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

  // Per-connection, per-message-type throttle — a cheap, in-process guard
  // against a single socket flooding the server, checked BEFORE touching the
  // database. Deliberately separate from LocationTrackingService's own
  // throttle: that one is the authoritative, state-based check (correct
  // across reconnects and multiple instances); this one just stops abuse
  // from one connection as early as possible. Cleared on disconnect.
  private readonly lastMessageAt = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly bookingsService: BookingsService,
    private readonly locationTrackingService: LocationTrackingService,
    private readonly workerProfilesService: WorkerProfilesService,
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
    for (const key of this.lastMessageAt.keys()) {
      if (key.startsWith(`${socket.id}:`)) {
        this.lastMessageAt.delete(key);
      }
    }
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

  /**
   * Worker-only: sends her own current position for one of her bookings.
   * LocationTrackingService.recordPoint is the structural enforcement that
   * the booking is actually ON_THE_WAY/ARRIVED/IN_PROGRESS — this handler
   * never second-guesses that decision, only relays its outcome.
   */
  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { bookingId?: string; point?: GeoPoint },
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!socket.user || !data?.bookingId || !data?.point) {
      return { ok: false, reason: 'forbidden' };
    }

    const minIntervalMs =
      this.configService.get<number>('location.updateMinIntervalSeconds', 5) * 1000;
    if (this.isRateLimited(socket, 'location:update', minIntervalMs)) {
      return { ok: false, reason: 'throttled' };
    }

    let workerProfileId: string;
    try {
      const profile = await this.workerProfilesService.getOwn(socket.user.userId);
      workerProfileId = profile.id as string;
    } catch {
      return { ok: false, reason: 'forbidden' };
    }

    const result = await this.locationTrackingService.recordPoint(
      workerProfileId,
      data.bookingId,
      data.point,
    );
    if (result.accepted) {
      this.emitToBooking(data.bookingId, 'location:update', {
        bookingId: data.bookingId,
        point: data.point,
        recordedAt: new Date(),
      });
    }
    return { ok: result.accepted, reason: result.reason };
  }

  private isRateLimited(socket: AuthenticatedSocket, key: string, minIntervalMs: number): boolean {
    const mapKey = `${socket.id}:${key}`;
    const now = Date.now();
    const last = this.lastMessageAt.get(mapKey);
    if (last !== undefined && now - last < minIntervalMs) {
      return true;
    }
    this.lastMessageAt.set(mapKey, now);
    return false;
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  emitToBooking(bookingId: string, event: string, payload: unknown): void {
    this.server.to(bookingRoom(bookingId)).emit(event, payload);
  }
}
