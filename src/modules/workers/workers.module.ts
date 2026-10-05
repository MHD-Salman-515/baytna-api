import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { PublicWorkersController } from './public-workers.controller';
import { PublicWorkersService } from './public-workers.service';
import { WorkerDocument, WorkerDocumentSchema } from './schemas/worker-document.schema';
import { WorkerProfile, WorkerProfileSchema } from './schemas/worker-profile.schema';
import { WorkerDocumentsService } from './worker-documents.service';
import { WorkerMeController } from './worker-me.controller';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkersAdminController } from './workers-admin.controller';
import { UploadRateLimiterService } from './upload-rate-limiter.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkerProfile.name, schema: WorkerProfileSchema },
      { name: WorkerDocument.name, schema: WorkerDocumentSchema },
    ]),
    AuditLogModule,
    CountriesModule,
    StorageModule,
    UsersModule,
  ],
  // WorkerMeController ('workers/me/...') MUST be registered before
  // PublicWorkersController ('workers/:id') — Nest/Express match routes in
  // registration order, and a literal '/workers/me/...' has to win over the
  // dynamic '/workers/:id' pattern, not the other way around.
  controllers: [WorkerMeController, WorkersAdminController, PublicWorkersController],
  providers: [
    WorkerProfilesService,
    WorkerDocumentsService,
    PublicWorkersService,
    UploadRateLimiterService,
    ApprovedWorkerGuard,
  ],
  exports: [WorkerProfilesService, WorkerDocumentsService],
})
export class WorkersModule {}
