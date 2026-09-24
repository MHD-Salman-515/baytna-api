import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { envValidationSchema } from './env.validation';
import { redactConnectionString } from './redact-connection-string';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the project root (no package.json found above ${startDir})`,
      );
    }
    dir = parent;
  }
}

const projectRoot = findProjectRoot(__dirname);

/** Override with ENV_FILE to point at a different env file; defaults to `.env` in the project root. */
export const envFileName = process.env.ENV_FILE || '.env';
export const envFilePath = resolve(projectRoot, envFileName);
export const envFileFound = existsSync(envFilePath);

// Side effect, on purpose: standalone scripts (seed, seed:verify, ...) run
// outside the Nest application context, so nothing loads .env for them the
// way ConfigModule.forRoot() does for the app. Importing this module — as the
// FIRST import in any standalone script — loads it before anything else reads
// process.env. dotenv never overwrites a variable already present in
// process.env, so an inline shell var (e.g. `ALLOW_REMOTE_SEED=true` exported
// beforehand) always wins over the .env file's value.
loadDotenv({ path: envFilePath });

/**
 * Validates process.env with the exact same Joi schema the Nest app uses
 * (see AppModule's ConfigModule.forRoot), so standalone scripts can never
 * drift out of sync with the app on what's required. Throws a diagnostic
 * error — naming whether the env file was found and its resolved path,
 * since that's the far more common failure than an actually-missing key —
 * rather than returning a result, since every caller wants to fail fast.
 */
export function assertValidEnv(): void {
  const { error } = envValidationSchema.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  });

  if (!error) {
    return;
  }

  const location = envFileFound
    ? `Env file found at: ${envFilePath}`
    : `No env file found at: ${envFilePath} (copy .env.example to .env, or set ENV_FILE to point elsewhere)`;

  const missingMongoUri = error.details.some((detail) => detail.path[0] === 'MONGODB_URI');
  const prefix = missingMongoUri
    ? 'MONGODB_URI is not set or invalid.'
    : 'Environment validation failed.';

  throw new Error([prefix, location, error.message].join('\n'));
}

/** Safe to log: never contains credentials, even if MONGODB_URI does. */
export function describeConfiguredMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  return uri ? redactConnectionString(uri) : '(not set)';
}
