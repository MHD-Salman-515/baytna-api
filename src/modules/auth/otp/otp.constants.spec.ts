describe('OTP_IP_THROTTLE_LIMIT / OTP_IP_THROTTLE_TTL_MS', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to 10 requests / 1 hour when unset', async () => {
    delete process.env.OTP_IP_THROTTLE_LIMIT;
    delete process.env.OTP_IP_THROTTLE_TTL_MS;

    const { OTP_IP_THROTTLE_LIMIT, OTP_IP_THROTTLE_TTL_MS } = await import('./otp.constants');

    expect(OTP_IP_THROTTLE_LIMIT).toBe(10);
    expect(OTP_IP_THROTTLE_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('picks up a looser staging value from env vars', async () => {
    process.env.OTP_IP_THROTTLE_LIMIT = '100';
    process.env.OTP_IP_THROTTLE_TTL_MS = '60000';

    const { OTP_IP_THROTTLE_LIMIT, OTP_IP_THROTTLE_TTL_MS } = await import('./otp.constants');

    expect(OTP_IP_THROTTLE_LIMIT).toBe(100);
    expect(OTP_IP_THROTTLE_TTL_MS).toBe(60000);
  });

  it('never affects the per-phone limits, which stay fixed regardless of env', async () => {
    process.env.OTP_IP_THROTTLE_LIMIT = '999';
    process.env.OTP_IP_THROTTLE_TTL_MS = '1';

    const { OTP_MAX_REQUESTS_PER_WINDOW, OTP_REQUEST_WINDOW_MS, OTP_COOLDOWN_MS } =
      await import('./otp.constants');

    expect(OTP_MAX_REQUESTS_PER_WINDOW).toBe(5);
    expect(OTP_REQUEST_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(OTP_COOLDOWN_MS).toBe(60 * 1000);
  });
});
