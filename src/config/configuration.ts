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
  publicBaseUrl: string;
  storageLocalDir: string;
  s3: {
    bucket?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
    forcePathStyle: boolean;
  };
  documentRetentionDays: number;
}

export default (): AppConfig => {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
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
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? '.local-storage',
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    documentRetentionDays: parseInt(process.env.DOCUMENT_RETENTION_DAYS ?? '90', 10),
  };
};
