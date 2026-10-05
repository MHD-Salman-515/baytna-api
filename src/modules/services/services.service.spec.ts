import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { Service } from './schemas/service.schema';
import { ServicesService } from './services.service';

function chainable(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['sort', 'skip', 'limit'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('ServicesService', () => {
  let service: ServicesService;
  let model: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    countDocuments: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
  };

  const validId = new Types.ObjectId().toString();

  beforeEach(async () => {
    model = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ServicesService, { provide: getModelToken(Service.name), useValue: model }],
    }).compile();

    service = module.get(ServicesService);
  });

  const dto = {
    key: 'CLEANING',
    name: { ar: 'تنظيف', en: 'Cleaning' },
    allowedPricingTypes: [PricingType.HOURLY],
  };

  describe('findActive', () => {
    it('filters by isActive and isDeleted', async () => {
      model.find.mockReturnValue(chainable([]));
      await service.findActive();
      expect(model.find).toHaveBeenCalledWith({ isActive: true, isDeleted: false });
    });
  });

  describe('create', () => {
    it('rejects a duplicate key among non-deleted services', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ key: 'CLEANING' }) });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('creates when the key is free', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ ...dto, _id: validId });
      await service.create(dto);
      expect(model.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findActiveById', () => {
    it('throws NotFoundException when inactive or missing', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.findActiveById(validId)).rejects.toThrow(NotFoundException);
    });

    it('returns the service when active', async () => {
      const doc = { _id: validId, key: 'CLEANING' };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      await expect(service.findActiveById(validId)).resolves.toEqual(doc);
      expect(model.findOne).toHaveBeenCalledWith({
        _id: validId,
        isActive: true,
        isDeleted: false,
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes and throws if nothing matched', async () => {
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 0 }) });
      await expect(service.remove(validId)).rejects.toThrow(NotFoundException);
    });

    it('succeeds when a match is found', async () => {
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1 }) });
      await expect(service.remove(validId)).resolves.toBeUndefined();
    });
  });
});
