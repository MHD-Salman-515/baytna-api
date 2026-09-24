import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),

  MONGODB_URI: Joi.string().uri().required(),

  API_PREFIX: Joi.string().default('api/v1'),

  CORS_ORIGINS: Joi.string().default('*'),

  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  ADMIN_API_KEY: Joi.string().min(16).required(),

  // Optional: comma-separated DNS servers (e.g. "1.1.1.1,8.8.8.8") applied to
  // Node's resolver before any Mongo connection. See apply-dns-servers.ts.
  DNS_SERVERS: Joi.string().optional(),
});
