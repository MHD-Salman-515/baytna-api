import { HttpException } from '@nestjs/common';
import { UploadRateLimiterService } from './upload-rate-limiter.service';

describe('UploadRateLimiterService', () => {
  let service: UploadRateLimiterService;

  beforeEach(() => {
    service = new UploadRateLimiterService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('allows requests under the per-user limit', () => {
    for (let i = 0; i < 20; i++) {
      expect(() => service.assertNotRateLimited('user-1')).not.toThrow();
    }
  });

  it('throws 429 once a single user exceeds the window limit', () => {
    for (let i = 0; i < 20; i++) service.assertNotRateLimited('user-1');
    expect(() => service.assertNotRateLimited('user-1')).toThrow(HttpException);
  });

  it('tracks each user independently — one user being limited does not affect another', () => {
    for (let i = 0; i < 20; i++) service.assertNotRateLimited('user-1');
    expect(() => service.assertNotRateLimited('user-1')).toThrow(HttpException);
    expect(() => service.assertNotRateLimited('user-2')).not.toThrow();
  });
});
