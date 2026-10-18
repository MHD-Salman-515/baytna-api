import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { RedisIoAdapter } from './redis-io.adapter';

const duplicate = jest.fn();
const quit = jest.fn().mockResolvedValue(undefined);

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    duplicate: duplicate.mockReturnValue({ quit }),
    quit,
  }));
});

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn().mockReturnValue('fake-adapter-constructor'),
}));

const createAdapter = (jest.requireMock('@socket.io/redis-adapter') as { createAdapter: jest.Mock })
  .createAdapter;

describe('RedisIoAdapter', () => {
  let adapter: RedisIoAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    quit.mockResolvedValue(undefined);
    duplicate.mockReturnValue({ quit });
    adapter = new RedisIoAdapter({} as INestApplicationContext);
  });

  it('does nothing extra to the server when Redis was never connected (dev default)', () => {
    const server = { adapter: jest.fn() };
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);

    const result = adapter.createIOServer(3001);

    expect(result).toBe(server);
    expect(server.adapter).not.toHaveBeenCalled();
  });

  it('attaches the Redis adapter to the server once connectToRedis has run', () => {
    adapter.connectToRedis('redis://localhost:6379');

    expect(createAdapter).toHaveBeenCalled();

    const server = { adapter: jest.fn() };
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);

    adapter.createIOServer(3001);

    expect(server.adapter).toHaveBeenCalledWith('fake-adapter-constructor');
  });

  it('duplicates the pub client for the sub client rather than opening a second independent connection', () => {
    adapter.connectToRedis('redis://localhost:6379');

    expect(duplicate).toHaveBeenCalledTimes(1);
  });

  it('quits both clients on disconnect', async () => {
    adapter.connectToRedis('redis://localhost:6379');

    await adapter.disconnect();

    expect(quit).toHaveBeenCalledTimes(2);
  });

  it('disconnect is a no-op when Redis was never connected', async () => {
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});
