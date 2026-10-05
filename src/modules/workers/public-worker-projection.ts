export interface PublicWorkerProfile {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
  bio: { ar?: string; en?: string };
  rating: number;
  cityId: string;
  serviceAreas: string[];
}

export interface PublicProjectionUserInput {
  profile?: { firstName?: string; lastName?: string };
}

export interface PublicProjectionWorkerInput {
  id: string;
  cityId: { toString(): string } | string;
  serviceAreas: Array<{ toString(): string } | string>;
  bio?: { ar?: string; en?: string };
  rating: number;
}

/**
 * The ONLY path a WorkerProfile/User pair may take to reach a customer.
 * Deliberately built as a hand-written object literal (never `{...worker}`
 * or a Mongoose `.toObject()`) naming exactly 7 output fields — phone,
 * documents, verificationStatus, countryId, isDeleted, reviewedBy, and
 * everything else on either input simply has no code path into the result,
 * now or if either schema grows new fields later.
 */
export function toPublicWorkerProfile(
  worker: PublicProjectionWorkerInput,
  user: PublicProjectionUserInput | null,
  profilePhotoUrl: string | null,
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
    cityId: worker.cityId.toString(),
    serviceAreas: worker.serviceAreas.map((city) => city.toString()),
  };
}
