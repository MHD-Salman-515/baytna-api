import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BookingsService } from '../bookings/bookings.service';
import { LocationTrackingService } from '../bookings/location-tracking.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { AuthenticatedSocket, RealtimeGateway } from './realtime.gateway';
import { bookingRoom, userRoom } from './rooms';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { get: jest.Mock };
  let bookingsService: { isPartyToBooking: jest.Mock };
  let locationTrackingService: { recordPoint: jest.Mock };
  let workerProfilesService: { getOwn: jest.Mock };

  function fakeSocket(overrides: Record<string, unknown> = {}): AuthenticatedSocket {
    return {
      id: 'socket-1',
      handshake: { auth: {}, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as AuthenticatedSocket;
  }

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    configService = {
      get: jest
        .fn()
        .mockImplementation((key: string, fallback?: unknown) =>
          key === 'jwtAccessSecret' ? 'access-secret' : fallback,
        ),
    };
    bookingsService = { isPartyToBooking: jest.fn() };
    locationTrackingService = { recordPoint: jest.fn() };
    workerProfilesService = { getOwn: jest.fn() };

    gateway = new RealtimeGateway(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      bookingsService as unknown as BookingsService,
      locationTrackingService as unknown as LocationTrackingService,
      workerProfilesService as unknown as WorkerProfilesService,
    );
  });

  describe('handleConnection', () => {
    it('disconnects a socket with no token at all', async () => {
      const socket = fakeSocket();

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('disconnects a socket whose token fails verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
      const socket = fakeSocket({ handshake: { auth: { token: 'bad.token' }, headers: {} } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('authenticates via handshake.auth.token and auto-joins the user room', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', roles: ['CUSTOMER'] });
      const socket = fakeSocket({ handshake: { auth: { token: 'good.token' }, headers: {} } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.user).toEqual({ userId: 'user-1', roles: ['CUSTOMER'] });
      expect(socket.join).toHaveBeenCalledWith(userRoom('user-1'));
    });

    it('also accepts a Bearer token in the handshake headers', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', roles: ['WORKER'] });
      const socket = fakeSocket({
        handshake: { auth: {}, headers: { authorization: 'Bearer good.token' } },
      });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good.token', {
        secret: 'access-secret',
      });
    });
  });

  describe('handleBookingJoin', () => {
    it('rejects an unauthenticated socket (connection auth did not attach a user)', async () => {
      const socket = fakeSocket();

      const result = await gateway.handleBookingJoin(socket, { bookingId: 'booking-1' });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(bookingsService.isPartyToBooking).not.toHaveBeenCalled();
    });

    it("rejects joining a booking the user isn't party to", async () => {
      bookingsService.isPartyToBooking.mockResolvedValue(false);
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['CUSTOMER'] as never } });

      const result = await gateway.handleBookingJoin(socket, {
        bookingId: 'someone-elses-booking',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(bookingsService.isPartyToBooking).toHaveBeenCalledWith(
        'user-1',
        'someone-elses-booking',
      );
    });

    it('rejects joining another room by id even for a user who IS a party to some booking', async () => {
      bookingsService.isPartyToBooking.mockImplementation(
        async (_userId: string, bookingId: string) => bookingId === 'own-booking',
      );
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['CUSTOMER'] as never } });

      const result = await gateway.handleBookingJoin(socket, { bookingId: 'other-booking' });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('allows joining a booking the user is a party to', async () => {
      bookingsService.isPartyToBooking.mockResolvedValue(true);
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });

      const result = await gateway.handleBookingJoin(socket, { bookingId: 'booking-1' });

      expect(result).toEqual({ ok: true });
      expect(socket.join).toHaveBeenCalledWith(bookingRoom('booking-1'));
    });

    it('rejects a join request missing a bookingId without ever querying', async () => {
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['CUSTOMER'] as never } });

      const result = await gateway.handleBookingJoin(socket, {});

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(bookingsService.isPartyToBooking).not.toHaveBeenCalled();
    });
  });

  describe('handleLocationUpdate', () => {
    const point = { type: 'Point' as const, coordinates: [36.3, 33.5] as [number, number] };

    function withServer() {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as unknown as { server: unknown }).server = { to };
      return { emit, to };
    }

    it('rejects an unauthenticated socket', async () => {
      const socket = fakeSocket();

      const result = await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(locationTrackingService.recordPoint).not.toHaveBeenCalled();
    });

    it('rejects a message missing bookingId or point without ever querying', async () => {
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });

      const result = await gateway.handleLocationUpdate(socket, {});

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(workerProfilesService.getOwn).not.toHaveBeenCalled();
    });

    it("rejects when the socket's user has no worker profile", async () => {
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });
      workerProfilesService.getOwn.mockRejectedValue(new Error('not found'));

      const result = await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(locationTrackingService.recordPoint).not.toHaveBeenCalled();
    });

    it('relays an accepted point to the booking room and reports ok', async () => {
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });
      workerProfilesService.getOwn.mockResolvedValue({ id: 'worker-profile-1' });
      locationTrackingService.recordPoint.mockResolvedValue({ accepted: true });
      const { to, emit } = withServer();

      const result = await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });

      expect(result).toEqual({ ok: true, reason: undefined });
      expect(locationTrackingService.recordPoint).toHaveBeenCalledWith(
        'worker-profile-1',
        'booking-1',
        point,
      );
      expect(to).toHaveBeenCalledWith(bookingRoom('booking-1'));
      expect(emit).toHaveBeenCalledWith(
        'location:update',
        expect.objectContaining({ bookingId: 'booking-1', point }),
      );
    });

    it('relays nothing and reports the rejection reason when the service rejects the point (e.g. wrong status)', async () => {
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });
      workerProfilesService.getOwn.mockResolvedValue({ id: 'worker-profile-1' });
      locationTrackingService.recordPoint.mockResolvedValue({
        accepted: false,
        reason: 'not_active',
      });
      const { to } = withServer();

      const result = await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });

      expect(result).toEqual({ ok: false, reason: 'not_active' });
      expect(to).not.toHaveBeenCalled();
    });

    it('throttles a second message from the same connection arriving within the configured minimum interval', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.updateMinIntervalSeconds' ? 5 : fallback,
      );
      const socket = fakeSocket({ user: { userId: 'user-1', roles: ['WORKER'] as never } });
      workerProfilesService.getOwn.mockResolvedValue({ id: 'worker-profile-1' });
      locationTrackingService.recordPoint.mockResolvedValue({ accepted: true });
      withServer();

      await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });
      const second = await gateway.handleLocationUpdate(socket, { bookingId: 'booking-1', point });

      expect(second).toEqual({ ok: false, reason: 'throttled' });
      expect(locationTrackingService.recordPoint).toHaveBeenCalledTimes(1);
    });

    it('does not throttle a different connection', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.updateMinIntervalSeconds' ? 5 : fallback,
      );
      const socketA = fakeSocket({
        id: 'socket-a',
        user: { userId: 'user-1', roles: ['WORKER'] as never },
      });
      const socketB = fakeSocket({
        id: 'socket-b',
        user: { userId: 'user-2', roles: ['WORKER'] as never },
      });
      workerProfilesService.getOwn.mockResolvedValue({ id: 'worker-profile-1' });
      locationTrackingService.recordPoint.mockResolvedValue({ accepted: true });
      withServer();

      await gateway.handleLocationUpdate(socketA, { bookingId: 'booking-1', point });
      const result = await gateway.handleLocationUpdate(socketB, { bookingId: 'booking-1', point });

      expect(result).toEqual({ ok: true, reason: undefined });
    });
  });

  describe('emitToUser / emitToBooking', () => {
    it('emits to the user room', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as unknown as { server: unknown }).server = { to };

      gateway.emitToUser('user-1', 'booking:statusChanged', { bookingId: 'b1' });

      expect(to).toHaveBeenCalledWith(userRoom('user-1'));
      expect(emit).toHaveBeenCalledWith('booking:statusChanged', { bookingId: 'b1' });
    });

    it('emits to the booking room', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as unknown as { server: unknown }).server = { to };

      gateway.emitToBooking('booking-1', 'location:update', { lat: 1, lng: 2 });

      expect(to).toHaveBeenCalledWith(bookingRoom('booking-1'));
      expect(emit).toHaveBeenCalledWith('location:update', { lat: 1, lng: 2 });
    });
  });
});
