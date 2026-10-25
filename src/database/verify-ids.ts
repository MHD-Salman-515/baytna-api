import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';
import { FIELDS } from './migrate-ids-to-objectid';

const logger = new Logger('VerifyIds');

/**
 * Asserts that every id-shaped field in the app (the same inventory
 * migrate-ids-to-objectid.ts uses) holds a real BSON ObjectId everywhere,
 * never a plain string — the thing the project-wide ObjectId-casting bug
 * silently violated before every @Prop was corrected to
 * mongoose.Schema.Types.ObjectId. Read-only; reports drift loudly and exits
 * non-zero, same contract as wallet:verify/reviews:verify.
 */
async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let driftCount = 0;

  try {
    logger.log(`Verifying against ${describeConfiguredMongoUri()}`);
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) {
      throw new Error('No active database connection to verify.');
    }

    for (const spec of FIELDS) {
      if (spec.kind === 'scalar') {
        const coll = db.collection(spec.collection);
        const nonObjectIdCount = await coll.countDocuments({
          [spec.field]: { $exists: true, $ne: null, $not: { $type: 'objectId' } },
        });
        if (nonObjectIdCount > 0) {
          driftCount += nonObjectIdCount;
          const examples = await coll
            .find({ [spec.field]: { $exists: true, $ne: null, $not: { $type: 'objectId' } } })
            .project({ [spec.field]: 1 })
            .limit(3)
            .toArray();
          logger.error(
            `[DRIFT] ${spec.collection}.${spec.field}: ${nonObjectIdCount} non-ObjectId value(s). ` +
              `Examples: ${examples.map((e) => JSON.stringify(e[spec.field.split('.')[0]])).join(', ')}`,
          );
        } else {
          logger.log(`[OK] ${spec.collection}.${spec.field}`);
        }
      } else if (spec.kind === 'scalarArray') {
        const coll = db.collection(spec.collection);
        const docs = await coll
          .find({ [spec.field]: { $exists: true, $ne: [] } })
          .project({ [spec.field]: 1 })
          .toArray();
        let bad = 0;
        for (const doc of docs) {
          for (const el of (doc[spec.field] ?? []) as unknown[]) {
            if (!(el instanceof Types.ObjectId)) bad++;
          }
        }
        if (bad > 0) {
          driftCount += bad;
          logger.error(
            `[DRIFT] ${spec.collection}.${spec.field}[]: ${bad} non-ObjectId element(s)`,
          );
        } else {
          logger.log(`[OK] ${spec.collection}.${spec.field}[]`);
        }
      } else {
        const coll = db.collection(spec.collection);
        const docs = await coll
          .find({ [spec.field]: { $exists: true, $ne: [] } })
          .project({ [spec.field]: 1 })
          .toArray();
        let bad = 0;
        for (const doc of docs) {
          for (const el of (doc[spec.field] ?? []) as Array<Record<string, unknown>>) {
            if (!(el[spec.subField!] instanceof Types.ObjectId) && el[spec.subField!] != null)
              bad++;
          }
        }
        if (bad > 0) {
          driftCount += bad;
          logger.error(
            `[DRIFT] ${spec.collection}.${spec.field}[].${spec.subField}: ${bad} non-ObjectId value(s)`,
          );
        } else {
          logger.log(`[OK] ${spec.collection}.${spec.field}[].${spec.subField}`);
        }
      }
    }
  } finally {
    await app.close();
  }

  if (driftCount > 0) {
    logger.error(`ids:verify FAILED — ${driftCount} non-ObjectId value(s) found.`);
    process.exit(1);
  }
  logger.log('ids:verify PASSED — every id field holds a real ObjectId everywhere.');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
