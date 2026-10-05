import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { ServicesService } from '../services/services.service';
import { PublicWorkersSortBy, SortOrder } from './dto/find-public-workers-query.dto';
import { VerificationStatus, WorkerProfile } from './schemas/worker-profile.schema';
import { WorkerService } from './schemas/worker-service.schema';
import { WorkerDocumentsService } from './worker-documents.service';
import { PublicWorkersService } from './public-workers.service';

describe('PublicWorkersService', () => {
  let service: PublicWorkersService;
  let profileModel: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock };
  let workerServiceModel: { find: jest.Mock };
  let workerDocumentsService: { getApprovedProfilePhotoUrl: jest.Mock };
  let servicesService: { findActive: jest.Mock };

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
    workerServiceModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    workerDocumentsService = { getApprovedProfilePhotoUrl: jest.fn().mockResolvedValue(null) };
    servicesService = { findActive: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicWorkersService,
        { provide: getModelToken(WorkerProfile.name), useValue: profileModel },
        { provide: getModelToken(WorkerService.name), useValue: workerServiceModel },
        { provide: WorkerDocumentsService, useValue: workerDocumentsService },
        { provide: ServicesService, useValue: servicesService },
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

    it('filters to only workers who actively offer the given serviceId', async () => {
      workerServiceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            workerProfileId: { toString: () => 'w1' },
            pricingType: PricingType.FIXED,
            fixed: { price: 100 },
          },
        ]),
      });
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findMany({ serviceId: 'service-1', page: 1, limit: 20, skip: 0 } as never);

      expect(workerServiceModel.find).toHaveBeenCalledWith({
        serviceId: 'service-1',
        isActive: true,
        isDeleted: false,
      });
      expect(profileModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: [{ toString: expect.any(Function) }] } }),
      );
    });

    it('sorts by price (in memory) when serviceId + sortBy=price are both given', async () => {
      const cheap = { toString: () => 'cheap' };
      const pricey = { toString: () => 'pricey' };
      // Two different queries go through the same model: the serviceId-filter
      // lookup (has a `serviceId` key) and, per profile, the "what does she
      // offer" lookup inside project() (has a `workerProfileId` key instead).
      workerServiceModel.find.mockImplementation((filter: Record<string, unknown>) => {
        if ('serviceId' in filter) {
          return {
            exec: jest.fn().mockResolvedValue([
              { workerProfileId: pricey, pricingType: PricingType.FIXED, fixed: { price: 9000 } },
              { workerProfileId: cheap, pricingType: PricingType.FIXED, fixed: { price: 1000 } },
            ]),
          };
        }
        return { exec: jest.fn().mockResolvedValue([]) };
      });
      // findMany() with a price sort fetches everything matching via .find().populate().exec() (no skip/limit chained in that branch).
      profileModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { id: 'pricey', cityId: null, serviceAreas: [], bio: {}, rating: 1, userId: null },
            { id: 'cheap', cityId: null, serviceAreas: [], bio: {}, rating: 1, userId: null },
          ]),
        }),
      });

      const result = await service.findMany({
        serviceId: 'service-1',
        sortBy: PublicWorkersSortBy.PRICE,
        sortOrder: SortOrder.ASC,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(result.data.map((w) => w.id)).toEqual(['cheap', 'pricey']);
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

    it('includes her offered services with resolved names in the projection', async () => {
      servicesService.findActive.mockResolvedValue([
        { id: 'service-1', name: { ar: 'تنظيف', en: 'Cleaning' } },
      ]);
      profileModel.find.mockReturnValue(
        chainable([{ id: 'w1', cityId: null, serviceAreas: [], bio: {}, rating: 5, userId: null }]),
      );
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
      workerServiceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            serviceId: { toString: () => 'service-1' },
            pricingType: PricingType.FIXED,
            fixed: { price: 5000 },
            currency: 'SYP',
          },
        ]),
      });

      const result = await service.findMany({ page: 1, limit: 20, skip: 0 } as never);

      expect(result.data[0].services).toEqual([
        {
          serviceId: 'service-1',
          serviceName: { ar: 'تنظيف', en: 'Cleaning' },
          pricingType: PricingType.FIXED,
          displayPrice: 5000,
          currency: 'SYP',
        },
      ]);
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
