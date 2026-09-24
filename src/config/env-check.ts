import { envFilePath, envFileFound } from './load-env'; // MUST be the first import: loads .env as a side effect

import { envValidationSchema } from './env.validation';
import { redactConnectionString } from './redact-connection-string';

/** Vars the app/scripts actually read, beyond the Nest-validated schema (docker-compose + seeder inputs). */
const EXTRA_KNOWN_KEYS = [
  'MONGO_ROOT_USERNAME',
  'MONGO_ROOT_PASSWORD',
  'MONGO_PORT',
  'REDIS_PORT',
  'ALLOW_REMOTE_SEED',
];

const SCHEMA_KEYS = Object.keys(
  (envValidationSchema.describe() as { keys: Record<string, unknown> }).keys,
);

function maskValue(key: string, rawValue: string): string {
  if (key === 'MONGODB_URI') {
    return redactConnectionString(rawValue);
  }
  // Every other value is masked to its last 4 characters, full stop — no
  // "this one's short/harmless" exception, so nobody has to double-guess
  // which vars this script considers safe to show in full.
  const tail = rawValue.slice(-4);
  return `${'*'.repeat(Math.max(0, rawValue.length - 4))}${tail}`;
}

function main(): void {
  console.log(`Env file: ${envFilePath} (${envFileFound ? 'found' : 'NOT FOUND'})`);
  console.log('');

  const allKeys = [...SCHEMA_KEYS, ...EXTRA_KNOWN_KEYS];
  const width = Math.max(...allKeys.map((k) => k.length));

  for (const key of allKeys) {
    const rawValue = process.env[key];
    const status = rawValue === undefined || rawValue === '' ? 'MISSING' : maskValue(key, rawValue);
    console.log(`${key.padEnd(width)}  ${status}`);
  }

  console.log('');
  const { error } = envValidationSchema.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (error) {
    console.log('Schema validation: FAILED');
    console.log(error.message);
    process.exit(1);
  }
  console.log('Schema validation: OK');
}

main();
