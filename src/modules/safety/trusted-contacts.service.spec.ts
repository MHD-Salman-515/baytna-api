import { NotFoundException } from '@nestjs/common';
import { TrustedContactsService } from './trusted-contacts.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('TrustedContactsService', () => {
  let service: TrustedContactsService;
  let contactModel: { find: jest.Mock; create: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    contactModel = { find: jest.fn(), create: jest.fn(), findOne: jest.fn() };
    service = new TrustedContactsService(contactModel as never);
  });

  describe('listOwn', () => {
    it('scopes to the caller and excludes soft-deleted rows', async () => {
      const sort = jest.fn().mockReturnValue(chainExec([]));
      contactModel.find.mockReturnValue({ sort });

      await service.listOwn('user-1');

      expect(contactModel.find).toHaveBeenCalledWith({ userId: 'user-1', isDeleted: false });
    });
  });

  describe('addOwn', () => {
    it('creates a contact scoped to the caller', async () => {
      contactModel.create.mockResolvedValue({ id: 'contact-1' });

      await service.addOwn('user-1', {
        name: 'Mother',
        phone: '+963900000000',
        relationship: 'Mother',
      });

      expect(contactModel.create).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'Mother',
        phone: '+963900000000',
        relationship: 'Mother',
      });
    });
  });

  describe('removeOwn', () => {
    it('soft-deletes a contact she owns', async () => {
      const contact = {
        isDeleted: false,
        deletedAt: null,
        save: jest.fn().mockResolvedValue(undefined),
      };
      contactModel.findOne.mockReturnValue(chainExec(contact));

      await service.removeOwn('user-1', 'contact-1');

      expect(contactModel.findOne).toHaveBeenCalledWith({
        _id: 'contact-1',
        userId: 'user-1',
        isDeleted: false,
      });
      expect(contact.isDeleted).toBe(true);
      expect(contact.save).toHaveBeenCalled();
    });

    it('throws NotFoundException for a contact that is not hers (or does not exist)', async () => {
      contactModel.findOne.mockReturnValue(chainExec(null));

      await expect(service.removeOwn('user-1', 'not-mine')).rejects.toThrow(NotFoundException);
    });
  });
});
