import { BadRequestException } from '@nestjs/common';
import { DirectAssignmentStrategy } from './direct-assignment.strategy';

describe('DirectAssignmentStrategy', () => {
  const strategy = new DirectAssignmentStrategy();

  it('passes through the customer-chosen workerProfileId unchanged', async () => {
    await expect(
      strategy.resolveWorker({
        workerProfileId: 'worker-1',
        workerServiceId: 'ws-1',
        serviceId: 'svc-1',
        countryId: 'country-1',
        cityId: 'city-1',
      }),
    ).resolves.toEqual({ workerProfileId: 'worker-1' });
  });

  it('rejects when no workerProfileId was chosen', async () => {
    await expect(
      strategy.resolveWorker({
        workerServiceId: 'ws-1',
        serviceId: 'svc-1',
        countryId: 'country-1',
        cityId: 'city-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
