import { LocalizedText } from '../../common/schemas/localized-text.schema';
import { FinancialStatus, VerificationStatus } from './schemas/worker-profile.schema';

export interface AdminWorkerProfile {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  countryId: string;
  cityId: string | null;
  bio: { ar?: string; en?: string };
  yearsOfExperience: number;
  languages: string[];
  serviceAreas: string[];
  verificationStatus: VerificationStatus;
  rejectionReason: LocalizedText | null;
  submittedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  isAvailable: boolean;
  financialStatus: FinancialStatus;
  rating: number;
  completedBookings: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AdminProjectionUserInput {
  phone: string;
  profile?: { firstName?: string; lastName?: string };
}

export interface AdminProjectionWorkerInput {
  id: string;
  userId: { toString(): string } | string;
  countryId: { toString(): string } | string;
  cityId: { toString(): string } | string | null;
  bio?: { ar?: string; en?: string };
  yearsOfExperience: number;
  languages: string[];
  serviceAreas: Array<{ toString(): string } | string>;
  verificationStatus: VerificationStatus;
  rejectionReason: LocalizedText | null;
  submittedAt: Date | null;
  reviewedBy: ({ toString(): string } | string) | null;
  reviewedAt: Date | null;
  isAvailable: boolean;
  financialStatus: FinancialStatus;
  rating: number;
  completedBookings: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * The admin-only counterpart to toPublicWorkerProfile (public-worker-
 * projection.ts) — admins may see her name, phone, documents,
 * verificationStatus and financialStatus; a customer never does, and this
 * function must never be reused on any customer-facing path. Still a
 * hand-written object literal, not a `{...worker}` spread: a schema field
 * added later gets no projection here without a deliberate decision, even
 * though the audience is admins rather than the public.
 */
export function toAdminWorkerProfile(
  worker: AdminProjectionWorkerInput,
  user: AdminProjectionUserInput | null,
): AdminWorkerProfile {
  const firstName = user?.profile?.firstName;
  const lastName = user?.profile?.lastName;
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  return {
    id: worker.id,
    userId: worker.userId.toString(),
    name,
    phone: user?.phone ?? null,
    countryId: worker.countryId.toString(),
    cityId: worker.cityId === null ? null : worker.cityId.toString(),
    bio: { ar: worker.bio?.ar, en: worker.bio?.en },
    yearsOfExperience: worker.yearsOfExperience,
    languages: worker.languages,
    serviceAreas: worker.serviceAreas.map((city) => city.toString()),
    verificationStatus: worker.verificationStatus,
    rejectionReason: worker.rejectionReason,
    submittedAt: worker.submittedAt,
    reviewedBy: worker.reviewedBy === null ? null : worker.reviewedBy.toString(),
    reviewedAt: worker.reviewedAt,
    isAvailable: worker.isAvailable,
    financialStatus: worker.financialStatus,
    rating: worker.rating,
    completedBookings: worker.completedBookings,
    createdAt: worker.createdAt ?? null,
    updatedAt: worker.updatedAt ?? null,
  };
}
