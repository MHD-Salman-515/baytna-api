import { NearestAvailableAssignmentStrategy } from './nearest-available-assignment.strategy';

describe('NearestAvailableAssignmentStrategy', () => {
  const strategy = new NearestAvailableAssignmentStrategy();

  it('always defers resolution (workerProfileId null) — matching is asynchronous, handled by InstantMatchingService', async () => {
    await expect(
      strategy.resolveWorker({
        workerServiceId: '',
        serviceId: 'svc-1',
        countryId: 'country-1',
        cityId: 'city-1',
      }),
    ).resolves.toEqual({ workerProfileId: null });
  });
});
