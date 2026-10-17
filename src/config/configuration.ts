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
  booking: {
    expirySweepEnabled: boolean;
    expirySweepIntervalSeconds: number;
    instantMatchingSweepEnabled: boolean;
    instantMatchingSweepIntervalSeconds: number;
    reminderLeadMinutes: number;
    reminderSweepEnabled: boolean;
    reminderSweepIntervalSeconds: number;
  };
  notifications: {
    // 'log' (default — no Firebase credentials needed, safe for dev/test) or 'fcm'.
    pushProvider: string;
    fcm: {
      projectId?: string;
      clientEmail?: string;
      privateKey?: string;
    };
  };
  realtime: {
    redisAdapterEnabled: boolean;
  };
  location: {
    updateMinIntervalSeconds: number;
    trailMaxPoints: number;
    trailRetentionHours: number;
    trailPurgeSweepEnabled: boolean;
    trailPurgeSweepIntervalSeconds: number;
  };
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
    booking: {
      expirySweepEnabled: process.env.BOOKING_EXPIRY_SWEEP_ENABLED !== 'false',
      expirySweepIntervalSeconds: parseInt(
        process.env.BOOKING_EXPIRY_SWEEP_INTERVAL_SECONDS ?? '300',
        10,
      ),
      instantMatchingSweepEnabled: process.env.BOOKING_INSTANT_SWEEP_ENABLED !== 'false',
      instantMatchingSweepIntervalSeconds: parseInt(
        process.env.BOOKING_INSTANT_SWEEP_INTERVAL_SECONDS ?? '5',
        10,
      ),
      reminderLeadMinutes: parseInt(process.env.SCHEDULED_REMINDER_LEAD_MINUTES ?? '60', 10),
      reminderSweepEnabled: process.env.SCHEDULED_REMINDER_SWEEP_ENABLED !== 'false',
      reminderSweepIntervalSeconds: parseInt(
        process.env.SCHEDULED_REMINDER_SWEEP_INTERVAL_SECONDS ?? '300',
        10,
      ),
    },
    notifications: {
      pushProvider: process.env.NOTIFICATION_PUSH_PROVIDER ?? 'log',
      fcm: {
        projectId: process.env.FCM_PROJECT_ID,
        clientEmail: process.env.FCM_CLIENT_EMAIL,
        // .env files commonly escape newlines in a PEM key as literal "\n" — restore them.
        privateKey: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
    },
    realtime: {
      redisAdapterEnabled: process.env.WEBSOCKET_REDIS_ADAPTER_ENABLED === 'true',
    },
    location: {
      updateMinIntervalSeconds: parseInt(
        process.env.LOCATION_UPDATE_MIN_INTERVAL_SECONDS ?? '5',
        10,
      ),
      trailMaxPoints: parseInt(process.env.LOCATION_TRAIL_MAX_POINTS ?? '200', 10),
      trailRetentionHours: parseInt(process.env.LOCATION_TRAIL_RETENTION_HOURS ?? '24', 10),
      trailPurgeSweepEnabled: process.env.LOCATION_TRAIL_PURGE_SWEEP_ENABLED !== 'false',
      trailPurgeSweepIntervalSeconds: parseInt(
        process.env.LOCATION_TRAIL_PURGE_SWEEP_INTERVAL_SECONDS ?? '300',
        10,
      ),
    },
  };
};
