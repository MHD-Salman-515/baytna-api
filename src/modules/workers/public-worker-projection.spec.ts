import { PricingType } from '../../common/enums/pricing-type.enum';
import { toPublicWorkerProfile } from './public-worker-projection';

const ALLOWED_KEYS = [
  'id',
  'displayName',
  'profilePhotoUrl',
  'bio',
  'rating',
  'cityId',
  'serviceAreas',
  'services',
].sort();

const ALLOWED_OFFERING_KEYS = [
  'serviceId',
  'serviceName',
  'pricingType',
  'displayPrice',
  'currency',
].sort();

// A deliberately over-stuffed "kitchen sink" input — every sensitive field a
// real WorkerProfile/User document carries, plus the legitimate public ones.
// If the mapper ever starts spreading its input instead of hand-picking
// fields, one of these will leak and the key-set assertion below will catch it.
function kitchenSinkWorker() {
  return {
    id: 'worker-1',
    cityId: { toString: () => 'city-1' },
    serviceAreas: [{ toString: () => 'city-1' }, { toString: () => 'city-2' }],
    bio: { ar: 'نبذة', en: 'bio' },
    rating: 4.8,
    // sensitive / internal — must never appear in the output
    userId: 'user-1',
    countryId: 'country-1',
    verificationStatus: 'APPROVED',
    rejectionReason: { en: 'leaked rejection reason' },
    reviewedBy: 'admin-1',
    reviewedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    completedBookings: 12,
  };
}

function kitchenSinkUser() {
  return {
    profile: { firstName: 'Lina', lastName: 'K.', avatar: 'documents/should-not-leak' },
    phone: '+963911111111',
    roles: ['WORKER'],
    status: 'ACTIVE',
    lastLoginAt: new Date(),
  };
}

// Same idea, for the new `services` field: a deliberately over-stuffed
// offering carrying fields a real WorkerService document has that must
// never reach a customer (commissionRate, earnings-shaped data).
function kitchenSinkOffering() {
  return {
    serviceId: 'service-1',
    serviceName: { ar: 'تنظيف', en: 'Cleaning' },
    pricingType: PricingType.FIXED,
    displayPrice: 7000,
    currency: 'SYP',
    // sensitive / internal — must never appear in the output
    commissionRate: 1500,
    workerEarnings: 5950,
    workerProfileId: 'worker-1',
  } as unknown as Parameters<typeof toPublicWorkerProfile>[3][number];
}

describe('toPublicWorkerProfile', () => {
  it('returns exactly the allowlisted keys — nothing more', () => {
    const result = toPublicWorkerProfile(
      kitchenSinkWorker(),
      kitchenSinkUser(),
      'https://signed.example/photo',
      [kitchenSinkOffering()],
    );
    expect(Object.keys(result).sort()).toEqual(ALLOWED_KEYS);
  });

  it('never includes the phone number anywhere in the serialized output', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null, []);
    expect(JSON.stringify(result)).not.toContain('+963911111111');
  });

  it('never includes verificationStatus, rejectionReason, reviewedBy, userId, or countryId', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null, []);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('APPROVED');
    expect(serialized).not.toContain('leaked rejection reason');
    expect(serialized).not.toContain('admin-1');
    expect(serialized).not.toContain('user-1');
    expect(serialized).not.toContain('country-1');
  });

  it('builds displayName from the user profile first/last name', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null, []);
    expect(result.displayName).toBe('Lina K.');
  });

  it('falls back to a generic displayName when the user has no profile name set', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), { profile: {} }, null, []);
    expect(result.displayName).toBe('Worker');
  });

  it('falls back to a generic displayName when user is null', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, []);
    expect(result.displayName).toBe('Worker');
  });

  it('passes through the given presigned profilePhotoUrl verbatim, including null', () => {
    expect(toPublicWorkerProfile(kitchenSinkWorker(), null, null, []).profilePhotoUrl).toBeNull();
    expect(
      toPublicWorkerProfile(kitchenSinkWorker(), null, 'https://x/y', []).profilePhotoUrl,
    ).toBe('https://x/y');
  });

  it('converts ObjectId-like cityId and serviceAreas to plain strings', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, []);
    expect(result.cityId).toBe('city-1');
    expect(result.serviceAreas).toEqual(['city-1', 'city-2']);
  });

  it('passes through a null cityId rather than throwing — a profile created via POST /workers/me/apply has no city yet', () => {
    const worker = { ...kitchenSinkWorker(), cityId: null };
    const result = toPublicWorkerProfile(worker, null, null, []);
    expect(result.cityId).toBeNull();
  });

  describe('services (offered services + pricing)', () => {
    it('includes the offering with exactly the allowlisted keys — nothing more', () => {
      const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, [
        kitchenSinkOffering(),
      ]);
      expect(result.services).toHaveLength(1);
      expect(Object.keys(result.services[0]).sort()).toEqual(ALLOWED_OFFERING_KEYS);
    });

    it('never includes commissionRate, workerEarnings, or workerProfileId anywhere in the serialized output', () => {
      const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, [
        kitchenSinkOffering(),
      ]);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('1500');
      expect(serialized).not.toContain('5950');
      expect(serialized).not.toContain('commissionRate');
      expect(serialized).not.toContain('workerEarnings');
    });

    it('defaults to an empty array when she offers nothing yet', () => {
      const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, []);
      expect(result.services).toEqual([]);
    });

    it('preserves displayPrice, currency, pricingType, and serviceName for each offering', () => {
      const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null, [
        kitchenSinkOffering(),
      ]);
      expect(result.services[0]).toEqual({
        serviceId: 'service-1',
        serviceName: { ar: 'تنظيف', en: 'Cleaning' },
        pricingType: PricingType.FIXED,
        displayPrice: 7000,
        currency: 'SYP',
      });
    });
  });
});
