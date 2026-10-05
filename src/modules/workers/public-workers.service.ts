import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { LocalizedName } from '../../common/schemas/localized-name.schema';
import { ServicesService } from '../services/services.service';
import {
  FindPublicWorkersQueryDto,
  PublicWorkersSortBy,
  SortOrder,
} from './dto/find-public-workers-query.dto';
import { getDisplayPrice } from './get-display-price';
import {
  PublicProjectionUserInput,
  PublicWorkerProfile,
  PublicWorkerServiceOffering,
  toPublicWorkerProfile,
} from './public-worker-projection';
import {
  VerificationStatus,
  WorkerProfile,
  WorkerProfileDocument,
} from './schemas/worker-profile.schema';
import { WorkerService, WorkerServiceDocument } from './schemas/worker-service.schema';
import { WorkerDocumentsService } from './worker-documents.service';

@Injectable()
export class PublicWorkersService {
  constructor(
    @InjectModel(WorkerProfile.name) private readonly profileModel: Model<WorkerProfileDocument>,
    @InjectModel(WorkerService.name)
    private readonly workerServiceModel: Model<WorkerServiceDocument>,
    private readonly workerDocumentsService: WorkerDocumentsService,
    private readonly servicesService: ServicesService,
  ) {}

  async findMany(query: FindPublicWorkersQueryDto): Promise<PaginatedResult<PublicWorkerProfile>> {
    const filter: Record<string, unknown> = {
      verificationStatus: VerificationStatus.APPROVED,
      isAvailable: true,
      isDeleted: false,
    };
    if (query.cityId) {
      filter.serviceAreas = query.cityId;
    }

    const serviceNameById = await this.buildServiceNameMap();

    let priceByProfileId: Map<string, number> | undefined;
    if (query.serviceId) {
      const matches = await this.workerServiceModel
        .find({ serviceId: query.serviceId, isActive: true, isDeleted: false })
        .exec();
      filter._id = { $in: matches.map((m) => m.workerProfileId) };
      if (query.sortBy === PublicWorkersSortBy.PRICE) {
        priceByProfileId = new Map(
          matches.map((m) => [m.workerProfileId.toString(), getDisplayPrice(m)]),
        );
      }
    }

    // Sorting by a specific service's price can't be expressed as a Mongo
    // sort on WorkerProfile (the price lives on a different collection) —
    // resolved in memory instead. Acceptable at today's scale; revisit with
    // an aggregation pipeline if the catalog/worker count grows enough for
    // "fetch every match unpaginated" to become a real cost.
    if (priceByProfileId) {
      const matches = await this.profileModel.find(filter).populate('userId').exec();
      const sortOrder = query.sortOrder === SortOrder.ASC ? 1 : -1;
      matches.sort((a, b) => {
        const priceA = priceByProfileId!.get(a.id as string) ?? 0;
        const priceB = priceByProfileId!.get(b.id as string) ?? 0;
        return (priceA - priceB) * sortOrder;
      });
      const total = matches.length;
      const page = matches.slice(query.skip, query.skip + query.limit);
      const data = await Promise.all(page.map((profile) => this.project(profile, serviceNameById)));
      return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
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

    const data = await Promise.all(
      profiles.map((profile) => this.project(profile, serviceNameById)),
    );
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
    const serviceNameById = await this.buildServiceNameMap();
    return this.project(profile, serviceNameById);
  }

  private async buildServiceNameMap(): Promise<Map<string, LocalizedName>> {
    const services = await this.servicesService.findActive();
    return new Map(services.map((s) => [s.id as string, s.name]));
  }

  private async project(
    profile: WorkerProfileDocument,
    serviceNameById: Map<string, LocalizedName>,
  ): Promise<PublicWorkerProfile> {
    const profilePhotoUrl = await this.workerDocumentsService.getApprovedProfilePhotoUrl(
      profile.id as string,
    );
    // Populated by Mongoose at runtime; typed loosely here since WorkerProfile's
    // own schema correctly types userId as an ObjectId for every other caller.
    const user = profile.userId as unknown as PublicProjectionUserInput;

    const offerings = await this.workerServiceModel
      .find({ workerProfileId: profile.id, isActive: true, isDeleted: false })
      .exec();
    const services: PublicWorkerServiceOffering[] = offerings.map((offering) => ({
      serviceId: offering.serviceId.toString(),
      serviceName: serviceNameById.get(offering.serviceId.toString()) ?? { ar: '', en: '' },
      pricingType: offering.pricingType,
      displayPrice: getDisplayPrice(offering),
      currency: offering.currency,
    }));

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
    return toPublicWorkerProfile(workerInput, user, profilePhotoUrl, services);
  }
}
