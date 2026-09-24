import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { CountriesService } from './countries.service';
import { Country } from './schemas/country.schema';

type MockModel = {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  countDocuments: jest.Mock;
  updateOne: jest.Mock;
  create: jest.Mock;
};

function chainable(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['sort', 'skip', 'limit'].forEach((method) => {
    chain[method] = jest.fn().mockReturnValue(chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('CountriesService', () => {
  let service: CountriesService;
  let model: MockModel;

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
      providers: [CountriesService, { provide: getModelToken(Country.name), useValue: model }],
    }).compile();

    service = module.get<CountriesService>(CountriesService);
  });

  describe('findActive', () => {
    it('returns only active, non-deleted countries', async () => {
      const docs = [{ code: 'SY' }];
      model.find.mockReturnValue(chainable(docs));

      const result = await service.findActive();

      expect(model.find).toHaveBeenCalledWith({ isActive: true, isDeleted: false });
      expect(result).toEqual(docs);
    });
  });

  describe('findAll', () => {
    it('paginates and builds meta', async () => {
      const docs = [{ code: 'SY' }, { code: 'IQ' }];
      model.find.mockReturnValue(chainable(docs));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });

      const result = await service.findAll({ page: 1, limit: 20, skip: 0 } as never);

      expect(result.data).toEqual(docs);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for an invalid id', async () => {
      await expect(service.findOne('not-an-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no country matches', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.findOne(validId)).rejects.toThrow(NotFoundException);
    });

    it('returns the country when found', async () => {
      const doc = { _id: validId, code: 'SY' };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(service.findOne(validId)).resolves.toEqual(doc);
    });
  });

  describe('create', () => {
    const dto = {
      code: 'SY',
      name: { ar: 'سوريا', en: 'Syria' },
      currencyCode: 'SYP',
      phonePrefix: '+963',
      commissionRate: 1500,
    };

    it('throws ConflictException when the code already exists', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ code: 'SY' }) });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('creates the country when the code is free', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ ...dto, _id: validId });

      const result = await service.create(dto);

      expect(model.create).toHaveBeenCalledWith(dto);
      expect(result).toMatchObject({ code: 'SY' });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing matched', async () => {
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 0 }) });

      await expect(service.remove(validId)).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes when a match is found', async () => {
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1 }) });

      await expect(service.remove(validId)).resolves.toBeUndefined();
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: validId, isDeleted: false },
        { isDeleted: true, deletedAt: expect.any(Date) },
      );
    });
  });
});
