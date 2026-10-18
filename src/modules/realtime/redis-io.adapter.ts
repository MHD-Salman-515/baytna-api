import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Horizontal scaling for the realtime layer: without this, a socket
 * connected to instance A never sees a room.emit() issued from instance B
 * (e.g. a notification dispatched by a request that happened to land on a
 * different instance). The Redis adapter relays every emit between
 * instances via pub/sub, so `RealtimeGateway.emitToUser`/`emitToBooking`
 * reach a socket regardless of which instance it's connected to.
 *
 * Wired in behind realtime.redisAdapterEnabled (WEBSOCKET_REDIS_ADAPTER_ENABLED)
 * — reuses the same REDIS_URL as RedisOtpStore, but Redis is NOT required
 * in development: a single instance works fine with the in-memory default
 * adapter, which is what boots when this flag is left off.
 */
export class RedisIoAdapter extends IoAdapter {
  private pubClient?: Redis;
  private subClient?: Redis;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  connectToRedis(redisUrl: string): void {
    this.pubClient = new Redis(redisUrl, { lazyConnect: false });
    this.subClient = this.pubClient.duplicate();
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
