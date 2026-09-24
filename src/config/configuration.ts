export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  mongodbUri: string;
  throttle: {
    ttl: number;
    limit: number;
  };
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  otpPepper: string;
  redisUrl?: string;
  seedAdminPhone?: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((origin) => origin.trim()),
  mongodbUri: process.env.MONGODB_URI as string,
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET as string,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
  otpPepper: process.env.OTP_PEPPER as string,
  redisUrl: process.env.REDIS_URL,
  seedAdminPhone: process.env.SEED_ADMIN_PHONE,
});
