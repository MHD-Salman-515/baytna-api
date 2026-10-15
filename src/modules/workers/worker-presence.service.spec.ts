import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { WorkerPresence } from './schemas/worker-presence.schema';
import { WorkerPresenceService } from './worker-presence.service';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkerServicesService } from './worker-services.service';

describe('WorkerPresenceService', () => {
  let service: WorkerPresenceService;
  let presenceModel: {
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    findOne: jest.Mock;
    aggregate: jest.Mock;
  };
  let workerProfilesService: { filterApprovedAvailableInCity: jest.Mock };
  let workerServicesService: { filterActiveOfferingForService: jest.Mock };

  const workerProfileId = 'worker-1';
  const point = { type: 'Point' as const, coordinates: [36.3, 33.5] as [number, number] };

  beforeEach(async () => {
    presenceModel = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      findOne: jest.fn(),
      aggregate: jest.fn(),
    };
    workerProfilesService = { filterApprovedAvailableInCity: jest.fn() };
    workerServicesService = { filterActiveOfferingForService: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerPresenceService,
        { provide: getModelToken(WorkerPresence.name), useValue: presenceModel },
        { provide: WorkerProfilesService, useValue: workerProfilesService },
        { provide: WorkerServicesService, useValue: workerServicesService },
      ],
    }).compile();

    service = module.get(WorkerPresenceService);
  });

  describe('goOnline', () => {
    it('upserts isOnline true with the location and a fresh heartbeat', async () => {
      presenceModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ workerProfileId, isOnline: true }),
      });

      await service.goOnline(workerProfileId, point);

      expect(presenceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { workerProfileId, isDeleted: false },
        { workerProfileId, isOnline: true, lastLocation: point, lastHeartbeatAt: expect.any(Date) },
        { new: true, upsert: true },
      );
    });
  });

  describe('goOffline', () => {
    it('flips isOnline false immediately', async () => {
      presenceModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
      await service.goOffline(workerProfileId);
      expect(presenceModel.updateOne).toHaveBeenCalledWith(
        { workerProfileId, isDeleted: false },
        { isOnline: false },
      );
    });
  });

  describe('heartbeat', () => {
    it('rejects when she never went online', async () => {
      presenceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.heartbeat(workerProfileId, point)).rejects.toThrow(BadRequestException);
    });

    it('refreshes location and lastHeartbeatAt when online', async () => {
      const existing = { lastLocation: null, lastHeartbeatAt: null, save: jest.fn() };
      existing.save = jest.fn().mockResolvedValue(existing);
      presenceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.heartbeat(workerProfileId, point);

      expect(existing.lastLocation).toEqual(point);
      expect(existing.lastHeartbeatAt).toBeInstanceOf(Date);
      expect(existing.save).toHaveBeenCalled();
    });
  });

  describe('findEligibleCandidates', () => {
    const candidateA = new Types.ObjectId();
    const candidateB = new Types.ObjectId();

    function geoResults(results: { workerProfileId: Types.ObjectId; distanceMeters: number }[]) {
      presenceModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue(results) });
    }

    it('returns [] immediately when nothing matches the geo query (no further filtering calls)', async () => {
      geoResults([]);
      const result = await service.findEligibleCandidates({
        serviceId: 'service-1',
        cityId: 'city-1',
        point,
        radiusMeters: 3000,
        staleAfterSeconds: 120,
        excludeWorkerProfileIds: [],
      });
      expect(result).toEqual([]);
      expect(workerProfilesService.filterApprovedAvailableInCity).not.toHaveBeenCalled();
    });

    it('intersects geo results with profile eligibility and active-offering filters', async () => {
      geoResults([
        { workerProfileId: candidateA, distanceMeters: 1200 },
        { workerProfileId: candidateB, distanceMeters: 2800 },
      ]);
      // Only candidateA passes BOTH the profile-eligibility and the offering checks.
      workerProfilesService.filterApprovedAvailableInCity.mockResolvedValue([
        candidateA.toString(),
        candidateB.toString(),
      ]);
      workerServicesService.filterActiveOfferingForService.mockResolvedValue([
        candidateA.toString(),
      ]);

      const result = await service.findEligibleCandidates({
        serviceId: 'service-1',
        cityId: 'city-1',
        point,
        radiusMeters: 3000,
        staleAfterSeconds: 120,
        excludeWorkerProfileIds: [],
      });

      expect(result).toEqual([{ workerProfileId: candidateA.toString(), distanceMeters: 1200 }]);
    });

    it('passes the staleness cutoff, radius, point, and exclude list into the $geoNear query', async () => {
      geoResults([]);
      const excludeId = new Types.ObjectId().toString();

      await service.findEligibleCandidates({
        serviceId: 'service-1',
        cityId: 'city-1',
        point,
        radiusMeters: 5000,
        staleAfterSeconds: 60,
        excludeWorkerProfileIds: [excludeId],
      });

      const pipeline = presenceModel.aggregate.mock.calls[0][0];
      const geoNearStage = pipeline[0].$geoNear;
      expect(geoNearStage.near).toEqual(point);
      expect(geoNearStage.maxDistance).toBe(5000);
      expect(geoNearStage.query.isOnline).toBe(true);
      expect(geoNearStage.query.workerProfileId.$nin).toHaveLength(1);
      expect(geoNearStage.query.lastHeartbeatAt.$gte).toBeInstanceOf(Date);
    });
  });
});
