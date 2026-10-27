import { PricingType } from '../../common/enums/pricing-type.enum';

export interface PublicWorkerServiceOffering {
  // The specific (workerProfileId, serviceId) offering — required by both
  // POST /bookings (SCHEDULED) and GET /pricing/quote. Identifies an
  // offering, not a person — not sensitive the way commissionRate or
  // workerEarnings are.
  workerServiceId: string;
  serviceId: string;
  serviceName: { ar: string; en: string };
  pricingType: PricingType;
  // The rate (HOURLY), cheapest/"starting from" tier (BY_SIZE), or flat
  // price (FIXED) — see getDisplayPrice(). Never the commission rate or
  // anything else internal to pricing.
  displayPrice: number;
  currency: string;
  // Only meaningful for HOURLY — null otherwise. Lets a client show/enforce
  // the minimum without round-tripping GET /pricing/quote first.
  minHours: number | null;
  // Only meaningful for BY_SIZE — null otherwise. Ascending by maxRooms,
  // same order WorkerServicesService validates at write time.
  bySizeTiers: Array<{ maxRooms: number; price: number }> | null;
}

export interface PublicWorkerProfile {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
  bio: { ar?: string; en?: string };
  rating: number;
  cityId: string | null;
  serviceAreas: string[];
  services: PublicWorkerServiceOffering[];
}

export interface PublicProjectionUserInput {
  profile?: { firstName?: string; lastName?: string };
}

export interface PublicProjectionWorkerInput {
  id: string;
  // Nullable because WorkerProfile.cityId is (a profile created via
  // POST /workers/me/apply starts with no city) — in practice always set by
  // the time she's APPROVED, but not schema-enforced, so this stays honest.
  cityId: { toString(): string } | string | null;
  serviceAreas: Array<{ toString(): string } | string>;
  bio?: { ar?: string; en?: string };
  rating: number;
}

/**
 * The ONLY path a WorkerProfile/User/WorkerService trio may take to reach a
 * customer. Deliberately built as a hand-written object literal (never
 * `{...worker}` or a Mongoose `.toObject()`) naming exactly 8 output fields
 * — phone, documents, verificationStatus, countryId, isDeleted, reviewedBy,
 * commissionRate, workerEarnings, and everything else on any input simply
 * has no code path into the result, now or if any schema grows new fields
 * later. `services` is itself built the same way, field by field — never a
 * spread of a WorkerService document, which is how a commission rate or
 * earnings figure would otherwise leak.
 */
export function toPublicWorkerProfile(
  worker: PublicProjectionWorkerInput,
  user: PublicProjectionUserInput | null,
  profilePhotoUrl: string | null,
  services: PublicWorkerServiceOffering[],
): PublicWorkerProfile {
  const firstName = user?.profile?.firstName;
  const lastName = user?.profile?.lastName;
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Worker';

  return {
    id: worker.id,
    displayName,
    profilePhotoUrl,
    bio: { ar: worker.bio?.ar, en: worker.bio?.en },
    rating: worker.rating,
    cityId: worker.cityId === null ? null : worker.cityId.toString(),
    serviceAreas: worker.serviceAreas.map((city) => city.toString()),
    services: services.map((offering) => ({
      workerServiceId: offering.workerServiceId,
      serviceId: offering.serviceId,
      serviceName: { ar: offering.serviceName.ar, en: offering.serviceName.en },
      pricingType: offering.pricingType,
      displayPrice: offering.displayPrice,
      currency: offering.currency,
      minHours: offering.minHours,
      bySizeTiers: offering.bySizeTiers,
    })),
  };
}
