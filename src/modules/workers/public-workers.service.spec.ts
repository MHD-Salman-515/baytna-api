import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { VerificationStatus, WorkerProfile } from './schemas/worker-profile.schema';
import { WorkerDocumentsService } from './worker-documents.service';
import { PublicWorkersService } from './public-workers.service';

describe('PublicWorkersService', () => {
  let service: PublicWorkersService;
  let profileModel: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock };
  let workerDocumentsService: { getApprovedProfilePhotoUrl: jest.Mock };

  function chainable(resolvedValue: unknown) {
    const chain: Record<string, jest.Mock> = {};
    ['populate', 'sort', 'skip', 'limit'].forEach(
      (m) => (chain[m] = jest.fn().mockReturnValue(chain)),
    );
    chain.exec = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  }

  beforeEach(async () => {
    profileModel = { find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() };
    workerDocumentsService = { getApprovedProfilePhotoUrl: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicWorkersService,
        { provide: getModelToken(WorkerProfile.name), useValue: profileModel },
        { provide: WorkerDocumentsService, useValue: workerDocumentsService },
      ],
    }).compile();

    service = module.get(PublicWorkersService);
  });

  describe('findMany', () => {
    it('only ever queries APPROVED, available, non-deleted profiles', async () => {
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findMany({ page: 1, limit: 20, skip: 0 } as never);

      expect(profileModel.find).toHaveBeenCalledWith({
        verificationStatus: VerificationStatus.APPROVED,
        isAvailable: true,
        isDeleted: false,
      });
    });

    it('adds a serviceAreas filter when cityId is given', async () => {
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findMany({ cityId: 'city-1', page: 1, limit: 20, skip: 0 } as never);

      expect(profileModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ serviceAreas: 'city-1' }),
      );
    });

    it('ignores serviceId — no worker/service relation exists yet', async () => {
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findMany({ serviceId: 'service-1', page: 1, limit: 20, skip: 0 } as never);

      const filterArg = profileModel.find.mock.calls[0][0];
      expect(filterArg).not.toHaveProperty('serviceId');
    });

    it('maps each result through the public projection', async () => {
      profileModel.find.mockReturnValue(
        chainable([
          {
            id: 'w1',
            cityId: { toString: () => 'city-1' },
            serviceAreas: [],
            bio: {},
            rating: 5,
            userId: { profile: { firstName: 'A' } },
          },
        ]),
      );
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      const result = await service.findMany({ page: 1, limit: 20, skip: 0 } as never);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ id: 'w1', displayName: 'A', rating: 5 }),
      );
      expect(result.data[0]).not.toHaveProperty('userId');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException if the worker is not APPROVED/available/non-deleted', async () => {
      profileModel.findOne.mockReturnValue(chainable(null));
      await expect(service.findOne('w1')).rejects.toThrow(NotFoundException);
    });

    it('returns the public projection when found', async () => {
      profileModel.findOne.mockReturnValue(
        chainable({
          id: 'w1',
          cityId: { toString: () => 'city-1' },
          serviceAreas: [],
          bio: {},
          rating: 4,
          userId: { profile: {} },
        }),
      );

      const result = await service.findOne('w1');
      expect(result.id).toBe('w1');
    });
  });
});
