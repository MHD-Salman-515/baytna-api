import { envValidationSchema } from './env.validation';

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MONGODB_URI: 'mongodb://localhost:27017/test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    OTP_PEPPER: 'c'.repeat(32),
    ...overrides,
  };
}

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });
}

describe('envValidationSchema — production HTTPS/CORS guards', () => {
  it('passes in development with no PUBLIC_BASE_URL, no S3_ENDPOINT, and CORS_ORIGINS=*', () => {
    const { error } = validate(baseEnv({ NODE_ENV: 'development' }));
    expect(error).toBeUndefined();
  });

  it('rejects production with no PUBLIC_BASE_URL set (would fall back to the http:// dev default)', () => {
    const { error } = validate(baseEnv({ NODE_ENV: 'production' }));
    expect(error?.message).toMatch(/PUBLIC_BASE_URL must be explicitly set to an https:\/\/ URL/);
  });

  it('rejects production with a plain http:// PUBLIC_BASE_URL', () => {
    const { error } = validate(
      baseEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://api.example.com' }),
    );
    expect(error?.message).toMatch(/PUBLIC_BASE_URL must be explicitly set to an https:\/\/ URL/);
  });

  it('accepts production with an https:// PUBLIC_BASE_URL and an explicit CORS allowlist', () => {
    const { error } = validate(
      baseEnv({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://admin.example.com',
      }),
    );
    expect(error).toBeUndefined();
  });

  it('rejects production with a plain http:// S3_ENDPOINT even if PUBLIC_BASE_URL is https', () => {
    const { error } = validate(
      baseEnv({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://admin.example.com',
        S3_BUCKET: 'bucket',
        S3_REGION: 'auto',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_ENDPOINT: 'http://r2.example.com',
      }),
    );
    expect(error?.message).toMatch(/S3_ENDPOINT must use https:\/\//);
  });

  it('accepts production with an https:// S3_ENDPOINT', () => {
    const { error } = validate(
      baseEnv({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://admin.example.com',
        S3_BUCKET: 'bucket',
        S3_REGION: 'auto',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_ENDPOINT: 'https://r2.example.com',
      }),
    );
    expect(error).toBeUndefined();
  });

  it('rejects production with CORS_ORIGINS unset (defaults to "*")', () => {
    const { error } = validate(
      baseEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com' }),
    );
    expect(error?.message).toMatch(/CORS_ORIGINS must be an explicit comma-separated allowlist/);
  });

  it('rejects production when CORS_ORIGINS contains "*" alongside real origins', () => {
    const { error } = validate(
      baseEnv({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://admin.example.com,*',
      }),
    );
    expect(error?.message).toMatch(/CORS_ORIGINS must be an explicit comma-separated allowlist/);
  });

  it('allows a wildcard CORS_ORIGINS in development', () => {
    const { error } = validate(baseEnv({ NODE_ENV: 'development', CORS_ORIGINS: '*' }));
    expect(error).toBeUndefined();
  });
});

describe('envValidationSchema — OTP_IP_THROTTLE_* ', () => {
  it('defaults OTP_IP_THROTTLE_LIMIT/TTL_MS when unset', () => {
    const { error, value } = validate(baseEnv());
    expect(error).toBeUndefined();
    expect(value.OTP_IP_THROTTLE_LIMIT).toBe(10);
    expect(value.OTP_IP_THROTTLE_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('accepts a looser staging override', () => {
    const { error, value } = validate(
      baseEnv({ OTP_IP_THROTTLE_LIMIT: '100', OTP_IP_THROTTLE_TTL_MS: '60000' }),
    );
    expect(error).toBeUndefined();
    expect(value.OTP_IP_THROTTLE_LIMIT).toBe(100);
    expect(value.OTP_IP_THROTTLE_TTL_MS).toBe(60000);
  });

  it('rejects a non-positive value', () => {
    const { error } = validate(baseEnv({ OTP_IP_THROTTLE_LIMIT: '0' }));
    expect(error?.message).toMatch(/OTP_IP_THROTTLE_LIMIT/);
  });
});
