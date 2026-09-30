import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

type MockModel = {
  findOne: jest.Mock;
  updateOne: jest.Mock;
  create: jest.Mock;
};

describe('UsersService', () => {
  let service: UsersService;
  let model: MockModel;

  const validId = new Types.ObjectId().toString();
  const countryId = new Types.ObjectId().toString();
  const phone = '+963911111111';

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getModelToken(User.name), useValue: model }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findById', () => {
    it('throws NotFoundException for an invalid id', async () => {
      await expect(service.findById('not-an-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no user matches', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.findById(validId)).rejects.toThrow(NotFoundException);
    });

    it('returns the user when found', async () => {
      const doc = { _id: validId, phone };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      await expect(service.findById(validId)).resolves.toEqual(doc);
    });
  });

  describe('findOrCreateByPhone', () => {
    it('creates a new user and reports isNewUser: true when none existed', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ _id: validId, phone, roles: [Role.CUSTOMER] });

      const result = await service.findOrCreateByPhone(phone, countryId);

      expect(result.isNewUser).toBe(true);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone, countryId, roles: [Role.CUSTOMER] }),
      );
    });

    it('reports isNewUser: false when a document already matched', async () => {
      const existing = { _id: validId, phone, roles: [Role.CUSTOMER] };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.findOrCreateByPhone(phone, countryId);

      expect(result.isNewUser).toBe(false);
      expect(result.user).toBe(existing);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('falls back to the winner on a concurrent-create race (duplicate key)', async () => {
      const winner = { _id: validId, phone, roles: [Role.CUSTOMER] };
      model.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(winner) });
      model.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

      const result = await service.findOrCreateByPhone(phone, countryId);

      expect(result.isNewUser).toBe(false);
      expect(result.user).toBe(winner);
    });
  });

  describe('upsertAdmin', () => {
    it('creates a new ADMIN user when none exists', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ _id: validId, phone, roles: [Role.ADMIN] });

      const result = await service.upsertAdmin(phone, countryId);

      expect(result.outcome).toBe('created');
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone, countryId, roles: [Role.ADMIN] }),
      );
    });

    it('leaves an existing admin unchanged', async () => {
      const existing = { _id: validId, phone, roles: [Role.ADMIN], save: jest.fn() };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.upsertAdmin(phone, countryId);

      expect(result.outcome).toBe('unchanged');
      expect(existing.save).not.toHaveBeenCalled();
    });

    it('promotes an existing non-admin user by adding the ADMIN role', async () => {
      const existing = {
        _id: validId,
        phone,
        roles: [Role.CUSTOMER],
        save: jest.fn().mockResolvedValue(undefined),
      };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.upsertAdmin(phone, countryId);

      expect(result.outcome).toBe('promoted');
      expect(existing.roles).toEqual([Role.CUSTOMER, Role.ADMIN]);
      expect(existing.save).toHaveBeenCalled();
    });
  });
});
