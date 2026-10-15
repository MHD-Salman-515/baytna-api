import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { ServicesModule } from '../services/services.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { PublicWorkersController } from './public-workers.controller';
import { PublicWorkersService } from './public-workers.service';
import { WorkerAvailability, WorkerAvailabilitySchema } from './schemas/worker-availability.schema';
import { WorkerDocument, WorkerDocumentSchema } from './schemas/worker-document.schema';
import { WorkerProfile, WorkerProfileSchema } from './schemas/worker-profile.schema';
import { WorkerService, WorkerServiceSchema } from './schemas/worker-service.schema';
import { WorkerAvailabilityController } from './worker-availability.controller';
import { WorkerAvailabilityService } from './worker-availability.service';
import { WorkerDocumentsService } from './worker-documents.service';
import { WorkerMeController } from './worker-me.controller';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkerServicesController } from './worker-services.controller';
import { WorkerServicesService } from './worker-services.service';
import { WorkersAdminController } from './workers-admin.controller';
import { UploadRateLimiterService } from './upload-rate-limiter.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkerProfile.name, schema: WorkerProfileSchema },
      { name: WorkerDocument.name, schema: WorkerDocumentSchema },
      { name: WorkerService.name, schema: WorkerServiceSchema },
      { name: WorkerAvailability.name, schema: WorkerAvailabilitySchema },
    ]),
    AuditLogModule,
    CountriesModule,
    StorageModule,
    UsersModule,
    ServicesModule,
  ],
  // WorkerMeController ('workers/me/...') MUST be registered before
  // PublicWorkersController ('workers/:id') — Nest/Express match routes in
  // registration order, and a literal '/workers/me/...' has to win over the
  // dynamic '/workers/:id' pattern, not the other way around.
  // WorkerServicesController ('workers/me/services') and
  // WorkerAvailabilityController ('workers/me/availability-windows') have no
  // overlapping dynamic segment with anything else, so their position
  // doesn't matter.
  controllers: [
    WorkerMeController,
    WorkerServicesController,
    WorkerAvailabilityController,
    WorkersAdminController,
    PublicWorkersController,
  ],
  providers: [
    WorkerProfilesService,
    WorkerDocumentsService,
    WorkerServicesService,
    WorkerAvailabilityService,
    PublicWorkersService,
    UploadRateLimiterService,
    ApprovedWorkerGuard,
  ],
  exports: [
    WorkerProfilesService,
    WorkerDocumentsService,
    WorkerServicesService,
    WorkerAvailabilityService,
  ],
})
export class WorkersModule {}
