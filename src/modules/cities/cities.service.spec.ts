import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { CitiesService } from './cities.service';
import { City } from './schemas/city.schema';

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

describe('CitiesService', () => {
  let service: CitiesService;
  let model: MockModel;

  const validId = new Types.ObjectId().toString();
  const countryId = new Types.ObjectId().toString();

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
      providers: [CitiesService, { provide: getModelToken(City.name), useValue: model }],
    }).compile();

    service = module.get<CitiesService>(CitiesService);
  });

  describe('findByCountry', () => {
    it('filters by countryId, active and non-deleted, and paginates', async () => {
      const docs = [{ name: { en: 'Damascus' } }];
      model.find.mockReturnValue(chainable(docs));
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      const result = await service.findByCountry({
        countryId,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(model.find).toHaveBeenCalledWith({
        countryId,
        isActive: true,
        isDeleted: false,
      });
      expect(result.data).toEqual(docs);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for an invalid id', async () => {
      await expect(service.findOne('not-an-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no city matches', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.findOne(validId)).rejects.toThrow(NotFoundException);
    });

    it('returns the city when found', async () => {
      const doc = { _id: validId, name: { en: 'Damascus' } };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(service.findOne(validId)).resolves.toEqual(doc);
    });
  });

  describe('create', () => {
    it('creates the city', async () => {
      const dto = {
        countryId,
        name: { ar: 'دمشق', en: 'Damascus' },
        center: { type: 'Point' as const, coordinates: [36.2765, 33.5138] as [number, number] },
      };
      model.create.mockResolvedValue({ ...dto, _id: validId });

      const result = await service.create(dto);

      expect(model.create).toHaveBeenCalledWith(dto);
      expect(result).toMatchObject({ countryId });
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
