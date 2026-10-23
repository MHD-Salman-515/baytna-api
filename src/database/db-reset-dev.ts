import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';
import { assertLocalMongoUri } from './seeders/seed-guard';
import { runSeed } from './seeders/seed';

const logger = new Logger('DbResetDev');

/**
 * Wipes every collection in the configured database, then re-seeds it from
 * scratch — for the dev/staging database only, never production. This is
 * destructive (every document in every collection, gone) so it's
 * deliberately hard to fire by accident, three independent gates, cheapest
 * first:
 *  1. `--confirm` must be passed on the command line.
 *  2. NODE_ENV must literally be "development".
 *  3. The MONGODB_URI host must look local, or ALLOW_REMOTE_SEED=true must
 *     be set — the exact same guard `npm run seed` already uses (this dev
 *     database happens to be a remote Atlas cluster, so that escape hatch
 *     is how this command is actually meant to be run here).
 */
async function bootstrap(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'Refusing to reset the database without --confirm. This permanently deletes every ' +
        'document in every collection. Re-run as: npm run db:reset-dev -- --confirm',
    );
  }

  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();

  if (process.env.NODE_ENV !== 'development') {
    throw new Error(
      `Refusing to reset the database: NODE_ENV is "${process.env.NODE_ENV}", not "development". ` +
        'This command wipes every collection and must never run against anything but a dev/staging database.',
    );
  }
  assertLocalMongoUri(process.env.MONGODB_URI as string);

  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    logger.log(`Resetting ${describeConfiguredMongoUri()}`);
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) {
      throw new Error('No active database connection to reset.');
    }

    const collections = await db.listCollections().toArray();
    if (collections.length === 0) {
      logger.log('No collections found — nothing to wipe.');
    }
    for (const { name } of collections) {
      const result = await db.collection(name).deleteMany({});
      logger.log(`  ${name}: deleted ${result.deletedCount} document(s)`);
    }
  } finally {
    await app.close();
  }

  logger.log('Every collection wiped. Re-seeding reference data...');
  await runSeed();
  logger.log('db:reset-dev complete.');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
