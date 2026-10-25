import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';

const logger = new Logger('MigrateIdsToObjectId');

/**
 * Every id-shaped field in the app, as of the project-wide ObjectId-casting
 * audit (every @nestjs/mongoose @Prop declared `type: Types.ObjectId` — the
 * BSON value class, not the Schema.Types.ObjectId SchemaType — which that
 * library silently mistypes as Mixed, so the field accepts whatever type it
 * was written with). This script exists for the day a database that DOES
 * hold real, valuable data needs the fix applied retroactively — it was
 * built and dry-run-tested during Phase 9 but never applied to this
 * project's own dev database, which was wiped and reseeded instead (see
 * db-reset-dev.ts) once every schema was corrected, so every document here
 * was written through the fixed schemas from the start.
 */
type FieldKind = 'scalar' | 'scalarArray' | 'subdocArray';

interface FieldSpec {
  collection: string;
  field: string; // for subdocArray, this is the array field; subField names the nested id field
  kind: FieldKind;
  subField?: string;
}

// Exported so verify-ids.ts shares the exact same field inventory rather than
// maintaining a second copy that could silently drift out of sync.
export const FIELDS: FieldSpec[] = [
  { collection: 'refresh_tokens', field: 'userId', kind: 'scalar' },
  { collection: 'bookings', field: 'customerId', kind: 'scalar' },
  { collection: 'bookings', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'bookings', field: 'serviceId', kind: 'scalar' },
  { collection: 'bookings', field: 'workerServiceId', kind: 'scalar' },
  { collection: 'bookings', field: 'countryId', kind: 'scalar' },
  { collection: 'bookings', field: 'cityId', kind: 'scalar' },
  { collection: 'bookings', field: 'cancellation.byUserId', kind: 'scalar' },
  { collection: 'worker_services', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'worker_services', field: 'serviceId', kind: 'scalar' },
  { collection: 'cities', field: 'countryId', kind: 'scalar' },
  { collection: 'service_pricing_rules', field: 'serviceId', kind: 'scalar' },
  { collection: 'service_pricing_rules', field: 'countryId', kind: 'scalar' },
  { collection: 'booking_offers', field: 'bookingId', kind: 'scalar' },
  { collection: 'booking_offers', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'booking_offers', field: 'workerServiceId', kind: 'scalar' },
  { collection: 'worker_profiles', field: 'userId', kind: 'scalar' },
  { collection: 'worker_profiles', field: 'countryId', kind: 'scalar' },
  { collection: 'worker_profiles', field: 'cityId', kind: 'scalar' },
  { collection: 'worker_profiles', field: 'reviewedBy', kind: 'scalar' },
  { collection: 'worker_profiles', field: 'serviceAreas', kind: 'scalarArray' },
  { collection: 'booking_location_trails', field: 'bookingId', kind: 'scalar' },
  { collection: 'worker_presences', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'worker_documents', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'worker_documents', field: 'reviewedBy', kind: 'scalar' },
  { collection: 'worker_availabilities', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'notification_preferences', field: 'userId', kind: 'scalar' },
  { collection: 'notification_logs', field: 'userId', kind: 'scalar' },
  { collection: 'device_tokens', field: 'userId', kind: 'scalar' },
  { collection: 'wallets', field: 'workerProfileId', kind: 'scalar' },
  { collection: 'wallets', field: 'countryId', kind: 'scalar' },
  { collection: 'wallet_entries', field: 'walletId', kind: 'scalar' },
  { collection: 'wallet_entries', field: 'bookingId', kind: 'scalar' },
  { collection: 'wallet_entries', field: 'createdBy', kind: 'scalar' },
  { collection: 'wallet_entries', field: 'reversesEntryId', kind: 'scalar' },
  { collection: 'audit_logs', field: 'actorUserId', kind: 'scalar' },
  { collection: 'audit_logs', field: 'targetId', kind: 'scalar' },
  { collection: 'users', field: 'countryId', kind: 'scalar' },
  { collection: 'users', field: 'cityId', kind: 'scalar' },
  { collection: 'reviews', field: 'bookingId', kind: 'scalar' },
  { collection: 'reviews', field: 'authorId', kind: 'scalar' },
  { collection: 'reviews', field: 'subjectId', kind: 'scalar' },
  { collection: 'reviews', field: 'hiddenBy', kind: 'scalar' },
  { collection: 'panic_alerts', field: 'bookingId', kind: 'scalar' },
  { collection: 'panic_alerts', field: 'triggeredByUserId', kind: 'scalar' },
  { collection: 'panic_alerts', field: 'notifiedAdminIds', kind: 'scalarArray' },
  { collection: 'panic_alerts', field: 'resolvedBy', kind: 'scalar' },
  { collection: 'trusted_contacts', field: 'userId', kind: 'scalar' },
  { collection: 'share_trip_tokens', field: 'bookingId', kind: 'scalar' },
  { collection: 'share_trip_tokens', field: 'createdByUserId', kind: 'scalar' },
  { collection: 'share_trip_tokens', field: 'revokedBy', kind: 'scalar' },
  { collection: 'reports', field: 'reporterId', kind: 'scalar' },
  { collection: 'reports', field: 'subjectId', kind: 'scalar' },
  { collection: 'reports', field: 'bookingId', kind: 'scalar' },
  { collection: 'reports', field: 'assignedTo', kind: 'scalar' },
  { collection: 'reports', field: 'resolvedBy', kind: 'scalar' },
  { collection: 'reports', field: 'internalNotes', kind: 'subdocArray', subField: 'authorId' },
];

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

interface FieldReport {
  collection: string;
  field: string;
  totalDocsTouched: number;
  alreadyObjectId: number;
  convertedOrWouldConvert: number;
  invalid: Array<{ docId: string; value: unknown }>;
}

async function auditOrMigrateScalar(
  connection: Connection,
  spec: FieldSpec,
  apply: boolean,
): Promise<FieldReport> {
  const coll = connection.db!.collection(spec.collection);
  const field = spec.field;

  const already = await coll.countDocuments({ [field]: { $type: 'objectId' } });
  const validStrings = await coll.countDocuments({
    [field]: { $type: 'string', $regex: OBJECT_ID_HEX },
  });
  const invalidDocs = await coll
    .find({
      [field]: { $type: 'string' },
      $expr: { $not: { $regexMatch: { input: `$${field}`, regex: OBJECT_ID_HEX.source } } },
    })
    .project({ [field]: 1 })
    .limit(20)
    .toArray();

  if (apply && validStrings > 0) {
    await coll.updateMany({ [field]: { $type: 'string', $regex: OBJECT_ID_HEX } }, [
      { $set: { [field]: { $toObjectId: `$${field}` } } },
    ]);
  }

  return {
    collection: spec.collection,
    field,
    totalDocsTouched: already + validStrings,
    alreadyObjectId: already,
    convertedOrWouldConvert: validStrings,
    invalid: invalidDocs.map((d) => ({ docId: String(d._id), value: d[field.split('.')[0]] })),
  };
}

async function auditOrMigrateScalarArray(
  connection: Connection,
  spec: FieldSpec,
  apply: boolean,
): Promise<FieldReport> {
  const coll = connection.db!.collection(spec.collection);
  const field = spec.field;

  // One pass over every document holding a non-empty array — classify each
  // element in JS rather than trying to pre-filter in the query, since a
  // single array can legitimately mix already-correct and not-yet-converted
  // elements (e.g. partway through a previous interrupted run).
  const docs = await coll
    .find({ [field]: { $exists: true, $ne: [] } })
    .project({ [field]: 1 })
    .toArray();

  let already = 0;
  let validStrings = 0;
  const invalid: Array<{ docId: string; value: unknown }> = [];

  for (const doc of docs) {
    const arr: unknown[] = doc[field] ?? [];
    for (const el of arr) {
      if (el instanceof Types.ObjectId) {
        already++;
      } else if (typeof el === 'string' && OBJECT_ID_HEX.test(el)) {
        validStrings++;
      } else if (typeof el === 'string') {
        invalid.push({ docId: String(doc._id), value: el });
      }
    }
  }

  if (apply && validStrings > 0 && invalid.length === 0) {
    await coll.updateMany({ [field]: { $elemMatch: { $type: 'string' } } }, [
      {
        $set: {
          [field]: {
            $map: {
              input: `$${field}`,
              as: 'el',
              in: {
                $cond: [{ $eq: [{ $type: '$$el' }, 'string'] }, { $toObjectId: '$$el' }, '$$el'],
              },
            },
          },
        },
      },
    ]);
  } else if (apply && invalid.length > 0) {
    logger.error(
      `  [SKIPPED APPLY] ${spec.collection}.${field}[]: ${invalid.length} invalid value(s) present — fix the data before applying.`,
    );
  }

  return {
    collection: spec.collection,
    field: `${field}[]`,
    totalDocsTouched: already + validStrings,
    alreadyObjectId: already,
    convertedOrWouldConvert: validStrings,
    invalid,
  };
}

async function auditOrMigrateSubdocArray(
  connection: Connection,
  spec: FieldSpec,
  apply: boolean,
): Promise<FieldReport> {
  const coll = connection.db!.collection(spec.collection);
  const arrayField = spec.field;
  const subField = spec.subField!;

  const docs = await coll
    .find({ [arrayField]: { $exists: true, $ne: [] } })
    .project({ [arrayField]: 1 })
    .toArray();

  let already = 0;
  let validStrings = 0;
  const invalid: Array<{ docId: string; value: unknown }> = [];

  for (const doc of docs) {
    const arr: Array<Record<string, unknown>> = doc[arrayField] ?? [];
    for (const el of arr) {
      const v = el[subField];
      if (v instanceof Types.ObjectId) already++;
      else if (typeof v === 'string' && OBJECT_ID_HEX.test(v)) validStrings++;
      else if (typeof v === 'string') invalid.push({ docId: String(doc._id), value: v });
    }
  }

  if (apply && validStrings > 0 && invalid.length === 0) {
    await coll.updateMany({ [arrayField]: { $exists: true, $ne: [] } }, [
      {
        $set: {
          [arrayField]: {
            $map: {
              input: `$${arrayField}`,
              as: 'el',
              in: {
                $mergeObjects: [
                  '$$el',
                  {
                    [subField]: {
                      $cond: [
                        { $eq: [{ $type: `$$el.${subField}` }, 'string'] },
                        { $toObjectId: `$$el.${subField}` },
                        `$$el.${subField}`,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ]);
  } else if (apply && invalid.length > 0) {
    logger.error(
      `  [SKIPPED APPLY] ${spec.collection}.${arrayField}[].${subField}: ${invalid.length} invalid value(s) present — fix the data before applying.`,
    );
  }

  return {
    collection: spec.collection,
    field: `${arrayField}[].${subField}`,
    totalDocsTouched: already + validStrings,
    alreadyObjectId: already,
    convertedOrWouldConvert: validStrings,
    invalid,
  };
}

async function bootstrap(): Promise<void> {
  const apply = process.argv.includes('--apply');

  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let anyInvalid = false;
  let anyConverted = false;

  try {
    logger.log(`${apply ? 'APPLYING' : 'DRY RUN'} against ${describeConfiguredMongoUri()}`);
    if (!apply) {
      logger.log('(dry run — nothing will be written; pass --apply to actually convert)');
    }
    const connection = app.get<Connection>(getConnectionToken());

    for (const spec of FIELDS) {
      let report: FieldReport;
      if (spec.kind === 'scalar') {
        report = await auditOrMigrateScalar(connection, spec, apply);
      } else if (spec.kind === 'scalarArray') {
        report = await auditOrMigrateScalarArray(connection, spec, apply);
      } else {
        report = await auditOrMigrateSubdocArray(connection, spec, apply);
      }

      const verb = apply ? 'converted' : 'would convert';
      const line =
        `[${apply ? 'APPLY' : 'DRY RUN'}] ${report.collection}.${report.field}: ` +
        `${verb} ${report.convertedOrWouldConvert} string -> ObjectId, ` +
        `${report.alreadyObjectId} already ObjectId` +
        (report.invalid.length > 0 ? `, ${report.invalid.length} INVALID (left untouched)` : '');

      if (report.invalid.length > 0) {
        anyInvalid = true;
        logger.error(line);
        for (const bad of report.invalid.slice(0, 5)) {
          logger.error(`    doc ${bad.docId}: invalid value ${JSON.stringify(bad.value)}`);
        }
      } else {
        logger.log(line);
      }
      if (report.convertedOrWouldConvert > 0) anyConverted = true;
    }
  } finally {
    await app.close();
  }

  if (anyInvalid) {
    logger.error(
      'One or more fields contain values that are neither a real ObjectId nor a valid ' +
        '24-hex-char string — those were left untouched. Investigate before re-running --apply.',
    );
    process.exit(1);
  }

  if (!apply && anyConverted) {
    logger.log('Dry run complete. Re-run with --apply to actually convert.');
  } else if (apply) {
    logger.log('Migration applied.');
  } else {
    logger.log('Dry run complete — nothing to convert.');
  }
}

// Only runs when this file is executed directly — importing `FIELDS` from
// verify-ids.ts must not also trigger a real (even dry-run) migration pass.
if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(redactMongoUrisInText(message));
    process.exit(1);
  });
}
