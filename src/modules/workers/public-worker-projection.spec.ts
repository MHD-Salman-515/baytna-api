import { toPublicWorkerProfile } from './public-worker-projection';

const ALLOWED_KEYS = [
  'id',
  'displayName',
  'profilePhotoUrl',
  'bio',
  'rating',
  'cityId',
  'serviceAreas',
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

describe('toPublicWorkerProfile', () => {
  it('returns exactly the allowlisted keys — nothing more', () => {
    const result = toPublicWorkerProfile(
      kitchenSinkWorker(),
      kitchenSinkUser(),
      'https://signed.example/photo',
    );
    expect(Object.keys(result).sort()).toEqual(ALLOWED_KEYS);
  });

  it('never includes the phone number anywhere in the serialized output', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null);
    expect(JSON.stringify(result)).not.toContain('+963911111111');
  });

  it('never includes verificationStatus, rejectionReason, reviewedBy, userId, or countryId', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('APPROVED');
    expect(serialized).not.toContain('leaked rejection reason');
    expect(serialized).not.toContain('admin-1');
    expect(serialized).not.toContain('user-1');
    expect(serialized).not.toContain('country-1');
  });

  it('builds displayName from the user profile first/last name', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), kitchenSinkUser(), null);
    expect(result.displayName).toBe('Lina K.');
  });

  it('falls back to a generic displayName when the user has no profile name set', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), { profile: {} }, null);
    expect(result.displayName).toBe('Worker');
  });

  it('falls back to a generic displayName when user is null', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null);
    expect(result.displayName).toBe('Worker');
  });

  it('passes through the given presigned profilePhotoUrl verbatim, including null', () => {
    expect(toPublicWorkerProfile(kitchenSinkWorker(), null, null).profilePhotoUrl).toBeNull();
    expect(toPublicWorkerProfile(kitchenSinkWorker(), null, 'https://x/y').profilePhotoUrl).toBe(
      'https://x/y',
    );
  });

  it('converts ObjectId-like cityId and serviceAreas to plain strings', () => {
    const result = toPublicWorkerProfile(kitchenSinkWorker(), null, null);
    expect(result.cityId).toBe('city-1');
    expect(result.serviceAreas).toEqual(['city-1', 'city-2']);
  });

  it('passes through a null cityId rather than throwing — a profile created via POST /workers/me/apply has no city yet', () => {
    const worker = { ...kitchenSinkWorker(), cityId: null };
    const result = toPublicWorkerProfile(worker, null, null);
    expect(result.cityId).toBeNull();
  });
});
