import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GeoPoint } from '../cities/schemas/city.schema';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkerServicesService } from './worker-services.service';
import { WorkerPresence, WorkerPresenceDocument } from './schemas/worker-presence.schema';

export interface EligibleCandidate {
  workerProfileId: string;
  distanceMeters: number;
}

export interface FindEligibleCandidatesParams {
  serviceId: string;
  cityId: string;
  point: GeoPoint;
  radiusMeters: number;
  staleAfterSeconds: number;
  excludeWorkerProfileIds: string[];
}

interface GeoNearResult {
  // Stored (and therefore returned) as a plain string, not an ObjectId —
  // see the note on `exclude` in findEligibleCandidates.
  workerProfileId: string;
  distanceMeters: number;
}

@Injectable()
export class WorkerPresenceService {
  constructor(
    @InjectModel(WorkerPresence.name)
    private readonly presenceModel: Model<WorkerPresenceDocument>,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerServicesService: WorkerServicesService,
  ) {}

  async goOnline(workerProfileId: string, location: GeoPoint): Promise<WorkerPresenceDocument> {
    const doc = await this.presenceModel
      .findOneAndUpdate(
        { workerProfileId, isDeleted: false },
        { workerProfileId, isOnline: true, lastLocation: location, lastHeartbeatAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();
    return doc as WorkerPresenceDocument;
  }

  /** Immediate: flips isOnline off right away, which is all matching eligibility checks — she drops out of the next broadcast instantly. */
  async goOffline(workerProfileId: string): Promise<void> {
    await this.presenceModel
      .updateOne({ workerProfileId, isDeleted: false }, { isOnline: false })
      .exec();
  }

  async heartbeat(workerProfileId: string, location: GeoPoint): Promise<WorkerPresenceDocument> {
    const existing = await this.presenceModel
      .findOne({ workerProfileId, isDeleted: false, isOnline: true })
      .exec();
    if (!existing) {
      throw new BadRequestException('Go online first via POST /workers/me/presence/online');
    }
    existing.lastLocation = location;
    existing.lastHeartbeatAt = new Date();
    await existing.save();
    return existing;
  }

  async getOwn(workerProfileId: string): Promise<WorkerPresenceDocument | null> {
    return this.presenceModel.findOne({ workerProfileId, isDeleted: false }).exec();
  }

  /**
   * Candidates for one broadcast wave, nearest first: online, heartbeat not
   * stale, within radiusMeters of `point`, not already notified for this
   * booking (dedup across waves), APPROVED + isAvailable + serving `cityId`,
   * and actively offering `serviceId`. Deliberately does NOT check for an
   * overlapping active booking — that needs the Booking model, which this
   * module has no access to; InstantMatchingService (bookings module)
   * applies that filter on top of this result.
   */
  async findEligibleCandidates(params: FindEligibleCandidatesParams): Promise<EligibleCandidate[]> {
    const staleCutoff = new Date(Date.now() - params.staleAfterSeconds * 1000);
    // Plain strings, not ObjectId instances: this path isn't cast by the
    // schema (ids flow through this whole app as opaque strings — see
    // InstantMatchingService's resolveOffers/markOutstandingOffersStale for
    // the one place that bit us), so an ObjectId here would never
    // BSON-equal the string-stored workerProfileId values and silently
    // exclude nothing.
    const exclude = params.excludeWorkerProfileIds;

    const geoResults = await this.presenceModel
      .aggregate<GeoNearResult>([
        {
          $geoNear: {
            near: params.point,
            distanceField: 'distanceMeters',
            maxDistance: params.radiusMeters,
            spherical: true,
            query: {
              isOnline: true,
              isDeleted: false,
              lastHeartbeatAt: { $gte: staleCutoff },
              workerProfileId: { $nin: exclude },
            },
          },
        },
        { $project: { workerProfileId: 1, distanceMeters: 1, _id: 0 } },
      ])
      .exec();

    if (geoResults.length === 0) {
      return [];
    }

    const geoCandidateIds = geoResults.map((r) => r.workerProfileId.toString());

    const [eligibleInCity, offeringService] = await Promise.all([
      this.workerProfilesService.filterApprovedAvailableInCity(geoCandidateIds, params.cityId),
      this.workerServicesService.filterActiveOfferingForService(geoCandidateIds, params.serviceId),
    ]);
    const eligibleSet = new Set(eligibleInCity);
    const offeringSet = new Set(offeringService);

    return geoResults
      .filter(
        (r) =>
          eligibleSet.has(r.workerProfileId.toString()) &&
          offeringSet.has(r.workerProfileId.toString()),
      )
      .map((r) => ({
        workerProfileId: r.workerProfileId.toString(),
        distanceMeters: r.distanceMeters,
      }));
  }
}
