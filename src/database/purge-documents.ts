import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';
import { AuditLogService } from '../modules/audit-log/audit-log.service';
import { AuditAction } from '../modules/audit-log/schemas/audit-log.schema';
import { FileStorage } from '../modules/storage/file-storage.interface';
import { FILE_STORAGE } from '../modules/storage/storage.constants';
import { User, UserDocument, UserStatus } from '../modules/users/schemas/user.schema';
import {
  WorkerDocument,
  WorkerDocumentDocument,
} from '../modules/workers/schemas/worker-document.schema';
import {
  WorkerProfile,
  WorkerProfileDocument,
} from '../modules/workers/schemas/worker-profile.schema';

const logger = new Logger('PurgeDocuments');

/**
 * Retention policy (see README "Document retention"):
 *
 * A worker's documents (ID photos, criminal record certificate, profile
 * photo) are retained for DOCUMENT_RETENTION_DAYS (default 90) after she has
 * "left" — defined as her User account reaching status DELETED, or her User
 * account itself being soft-deleted — measured from whichever of those
 * happened. After that window, every document tied to her WorkerProfile is
 * permanently removed: the storage object AND the WorkerDocument row (not a
 * soft delete — see the note in worker-documents.service.ts#deleteOwn for
 * why real deletion is the right call for sensitive documents once there's
 * no remaining reason to keep them). Each deletion writes a DOCUMENT_PURGED
 * audit entry with a null actorUserId (a script, not an admin, did this).
 *
 * This script is dry-run by default — it only reports what it WOULD purge.
 * Pass PURGE_EXECUTE=true to actually delete anything.
 */
async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const execute = process.env.PURGE_EXECUTE === 'true';
  logger.log(
    `Mode: ${execute ? 'EXECUTE — documents will be permanently deleted' : 'DRY RUN — no changes will be made'}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    logger.log(`Connected to ${describeConfiguredMongoUri()}`);

    const configService = app.get(ConfigService);
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const profileModel = app.get<Model<WorkerProfileDocument>>(getModelToken(WorkerProfile.name));
    const documentModel = app.get<Model<WorkerDocumentDocument>>(
      getModelToken(WorkerDocument.name),
    );
    const storage = app.get<FileStorage>(FILE_STORAGE);
    const auditLogService = app.get(AuditLogService);

    const retentionDays = configService.get<number>('documentRetentionDays', 90);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    logger.log(`Retention window: ${retentionDays} days (cutoff: ${cutoff.toISOString()})`);

    const departedUsers = await userModel
      .find({
        $or: [
          { status: UserStatus.DELETED, updatedAt: { $lte: cutoff } },
          { isDeleted: true, deletedAt: { $lte: cutoff } },
        ],
      })
      .exec();

    logger.log(`${departedUsers.length} departed user(s) past the retention window`);

    let eligibleDocumentCount = 0;
    let purgedDocumentCount = 0;

    for (const user of departedUsers) {
      const profile = await profileModel.findOne({ userId: user._id }).exec();
      if (!profile) continue;

      const documents = await documentModel.find({ workerProfileId: profile._id }).exec();
      if (documents.length === 0) continue;

      logger.log(
        `Worker profile ${profile.id as string} (user ${user.id as string}): ${documents.length} document(s)`,
      );

      for (const document of documents) {
        eligibleDocumentCount += 1;
        // Never logs the storage key — type and upload date are enough to identify the candidate.
        logger.log(
          `  - ${document.id as string}: type=${document.type} uploaded=${document.createdAt?.toISOString()}`,
        );

        if (!execute) {
          continue;
        }

        await storage.deleteObject(document.storageKey);
        await documentModel.deleteOne({ _id: document._id }).exec();
        await auditLogService.record({
          actorUserId: null,
          action: AuditAction.DOCUMENT_PURGED,
          targetType: 'WorkerDocument',
          targetId: document.id as string,
          metadata: {
            workerProfileId: profile.id,
            documentType: document.type,
            reason: 'retention-policy',
          },
        });
        purgedDocumentCount += 1;
      }
    }

    if (execute) {
      logger.log(`Purged ${purgedDocumentCount} document(s).`);
    } else {
      logger.log(
        `DRY RUN: ${eligibleDocumentCount} document(s) would be purged. Re-run with PURGE_EXECUTE=true to actually delete them.`,
      );
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
