import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AdminFindWorkersQueryDto } from './dto/admin-find-workers-query.dto';
import { ReviewWorkerDto } from './dto/review-worker.dto';
import { UpsertWorkerProfileDto } from './dto/upsert-worker-profile.dto';
import { getRequiredDocumentTypes } from './document-requirements.config';
import {
  VerificationStatus,
  WorkerProfile,
  WorkerProfileDocument,
} from './schemas/worker-profile.schema';
import { WorkerDocumentsService } from './worker-documents.service';
import { assertValidTransition } from './worker-verification.state-machine';

const REVIEW_ACTION_TO_STATUS: Record<ReviewWorkerDto['action'], VerificationStatus> = {
  approve: VerificationStatus.APPROVED,
  reject: VerificationStatus.REJECTED,
  suspend: VerificationStatus.SUSPENDED,
};

const REVIEW_ACTION_TO_AUDIT_ACTION: Record<ReviewWorkerDto['action'], AuditAction> = {
  approve: AuditAction.WORKER_APPROVED,
  reject: AuditAction.WORKER_REJECTED,
  suspend: AuditAction.WORKER_SUSPENDED,
};

@Injectable()
export class WorkerProfilesService {
  constructor(
    @InjectModel(WorkerProfile.name) private readonly profileModel: Model<WorkerProfileDocument>,
    private readonly countriesService: CountriesService,
    private readonly workerDocumentsService: WorkerDocumentsService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Self-service "become a worker": grants Role.WORKER (additive — never
   * touches/removes CUSTOMER) and creates a bare DRAFT WorkerProfile if she
   * doesn't have one. Idempotent: a second call for someone who already has
   * a profile just returns it as-is — it NEVER resets an existing status
   * back to DRAFT, which would otherwise let anyone silently un-approve or
   * un-suspend herself just by calling this again. The audit entry is only
   * written the first time (profile creation), not on an idempotent replay.
   */
  async applyToBecomeWorker(userId: string): Promise<WorkerProfileDocument> {
    const user = await this.usersService.findById(userId); // throws NotFoundException if missing or soft-deleted
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Only active users can apply to become a worker');
    }

    await this.usersService.addRole(userId, Role.WORKER);

    const existing = await this.profileModel.findOne({ userId, isDeleted: false }).exec();
    if (existing) {
      return existing;
    }

    const created = await this.profileModel.create({
      userId,
      countryId: user.countryId,
      cityId: user.cityId ?? null,
    });

    await this.auditLogService.record({
      actorUserId: userId,
      action: AuditAction.WORKER_APPLIED,
      targetType: 'WorkerProfile',
      targetId: created.id as string,
      metadata: {},
    });

    return created;
  }

  /**
   * Create-or-update, scoped to the given userId. Deliberately never touches
   * verificationStatus either way — an APPROVED worker editing her bio must
   * not silently become un-approved, and a new profile already defaults to
   * DRAFT via the schema. Only submit()/reviewWorker() change status.
   */
  async upsertOwn(userId: string, dto: UpsertWorkerProfileDto): Promise<WorkerProfileDocument> {
    await this.countriesService.findActiveById(dto.countryId);

    const existing = await this.profileModel.findOne({ userId, isDeleted: false }).exec();
    const fields = {
      countryId: dto.countryId,
      cityId: dto.cityId,
      bio: dto.bio ?? existing?.bio ?? {},
      yearsOfExperience: dto.yearsOfExperience ?? existing?.yearsOfExperience ?? 0,
      languages: dto.languages ?? existing?.languages ?? [],
      serviceAreas: dto.serviceAreas ?? existing?.serviceAreas ?? [],
    };

    if (existing) {
      existing.set(fields);
      await existing.save();
      return existing;
    }

    return this.profileModel.create({ userId, ...fields });
  }

  async getOwn(userId: string): Promise<WorkerProfileDocument> {
    const profile = await this.profileModel.findOne({ userId, isDeleted: false }).exec();
    if (!profile) {
      throw new NotFoundException('Worker profile not found — create one first');
    }
    return profile;
  }

  async setAvailability(userId: string, isAvailable: boolean): Promise<WorkerProfileDocument> {
    const profile = await this.getOwn(userId);
    profile.isAvailable = isAvailable;
    await profile.save();
    return profile;
  }

  async submit(userId: string): Promise<WorkerProfileDocument> {
    const profile = await this.getOwn(userId);
    assertValidTransition(profile.verificationStatus, VerificationStatus.PENDING_REVIEW);

    const country = await this.countriesService.findActiveById(profile.countryId.toString());
    const requiredTypes = getRequiredDocumentTypes(country.code);
    const complete = await this.workerDocumentsService.hasAllRequiredDocuments(
      profile.id as string,
      requiredTypes,
    );
    if (!complete) {
      throw new BadRequestException(
        `Cannot submit for review: missing or rejected required documents (required: ${requiredTypes.join(', ')})`,
      );
    }

    profile.verificationStatus = VerificationStatus.PENDING_REVIEW;
    profile.rejectionReason = null;
    await profile.save();
    return profile;
  }

  async listForAdmin(query: AdminFindWorkersQueryDto): Promise<PaginatedResult<WorkerProfile>> {
    const filter = query.status ? { verificationStatus: query.status } : {};
    const [data, total] = await Promise.all([
      this.profileModel
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.profileModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  /** Admin visibility: no isDeleted filter, consistent with every other admin read in this app. */
  async getForAdmin(workerProfileId: string): Promise<WorkerProfileDocument> {
    const profile = await this.profileModel.findOne({ _id: workerProfileId }).exec();
    if (!profile) {
      throw new NotFoundException('Worker profile not found');
    }
    return profile;
  }

  /**
   * Used by PricingService to gate quoting on exactly the same visibility
   * rule as the public listing (APPROVED + available + non-deleted) — a
   * customer should never be able to get a quote for a worker she couldn't
   * otherwise see. Returns null rather than throwing; the caller decides
   * what "not quotable" should look like.
   */
  async findApprovedById(workerProfileId: string): Promise<WorkerProfileDocument | null> {
    return this.profileModel
      .findOne({
        _id: workerProfileId,
        verificationStatus: VerificationStatus.APPROVED,
        isAvailable: true,
        isDeleted: false,
      })
      .exec();
  }

  async reviewWorker(
    adminUserId: string,
    workerProfileId: string,
    dto: ReviewWorkerDto,
  ): Promise<WorkerProfileDocument> {
    const profile = await this.getForAdmin(workerProfileId);
    const previousStatus = profile.verificationStatus;
    const targetStatus = REVIEW_ACTION_TO_STATUS[dto.action];
    assertValidTransition(previousStatus, targetStatus);

    if (dto.action === 'reject' && !dto.reason?.ar && !dto.reason?.en) {
      throw new BadRequestException('A reason is required when rejecting a worker');
    }

    profile.verificationStatus = targetStatus;
    profile.rejectionReason = dto.action === 'approve' ? null : (dto.reason ?? null);
    profile.reviewedBy = adminUserId as unknown as WorkerProfileDocument['reviewedBy'];
    profile.reviewedAt = new Date();
    await profile.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: REVIEW_ACTION_TO_AUDIT_ACTION[dto.action],
      targetType: 'WorkerProfile',
      targetId: workerProfileId,
      metadata: { from: previousStatus, to: targetStatus },
    });

    return profile;
  }
}
