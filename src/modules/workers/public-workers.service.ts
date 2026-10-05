import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { FindPublicWorkersQueryDto } from './dto/find-public-workers-query.dto';
import {
  PublicProjectionUserInput,
  PublicWorkerProfile,
  toPublicWorkerProfile,
} from './public-worker-projection';
import {
  VerificationStatus,
  WorkerProfile,
  WorkerProfileDocument,
} from './schemas/worker-profile.schema';
import { WorkerDocumentsService } from './worker-documents.service';

@Injectable()
export class PublicWorkersService {
  constructor(
    @InjectModel(WorkerProfile.name) private readonly profileModel: Model<WorkerProfileDocument>,
    private readonly workerDocumentsService: WorkerDocumentsService,
  ) {}

  async findMany(query: FindPublicWorkersQueryDto): Promise<PaginatedResult<PublicWorkerProfile>> {
    // serviceId is accepted but intentionally not applied — no worker/service
    // relation exists until the Phase 4 service catalog lands.
    const filter: Record<string, unknown> = {
      verificationStatus: VerificationStatus.APPROVED,
      isAvailable: true,
      isDeleted: false,
    };
    if (query.cityId) {
      filter.serviceAreas = query.cityId;
    }

    const [profiles, total] = await Promise.all([
      this.profileModel
        .find(filter)
        .populate('userId')
        .sort({ rating: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.profileModel.countDocuments(filter).exec(),
    ]);

    const data = await Promise.all(profiles.map((profile) => this.project(profile)));
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async findOne(workerProfileId: string): Promise<PublicWorkerProfile> {
    const profile = await this.profileModel
      .findOne({
        _id: workerProfileId,
        verificationStatus: VerificationStatus.APPROVED,
        isAvailable: true,
        isDeleted: false,
      })
      .populate('userId')
      .exec();

    if (!profile) {
      throw new NotFoundException('Worker not found');
    }
    return this.project(profile);
  }

  private async project(profile: WorkerProfileDocument): Promise<PublicWorkerProfile> {
    const profilePhotoUrl = await this.workerDocumentsService.getApprovedProfilePhotoUrl(
      profile.id as string,
    );
    // Populated by Mongoose at runtime; typed loosely here since WorkerProfile's
    // own schema correctly types userId as an ObjectId for every other caller.
    const user = profile.userId as unknown as PublicProjectionUserInput;
    // Named fields only, matching PublicProjectionWorkerInput exactly — no
    // `.toObject()`/spread here either, for the same reason the mapper itself
    // avoids it: profile.id is typed optional on a raw Mongoose document, but
    // everything else already matches, so there's nothing to coerce but that.
    const workerInput = {
      id: profile.id as string,
      cityId: profile.cityId,
      serviceAreas: profile.serviceAreas,
      bio: profile.bio,
      rating: profile.rating,
    };
    return toPublicWorkerProfile(workerInput, user, profilePhotoUrl);
  }
}
