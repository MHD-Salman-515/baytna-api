import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { CountriesService } from '../countries/countries.service';
import { DocumentType } from './schemas/worker-document.schema';
import { VerificationStatus, WorkerProfile } from './schemas/worker-profile.schema';
import { WorkerDocumentsService } from './worker-documents.service';
import { WorkerProfilesService } from './worker-profiles.service';

describe('WorkerProfilesService', () => {
  let service: WorkerProfilesService;
  let profileModel: {
    findOne: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let countriesService: { findActiveById: jest.Mock };
  let workerDocumentsService: { hasAllRequiredDocuments: jest.Mock };
  let auditLogService: { record: jest.Mock };

  function chainable(resolvedValue: unknown) {
    const chain: Record<string, jest.Mock> = {};
    ['sort', 'skip', 'limit'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
    chain.exec = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  }

  beforeEach(async () => {
    profileModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    countriesService = { findActiveById: jest.fn().mockResolvedValue({ code: 'SY' }) };
    workerDocumentsService = { hasAllRequiredDocuments: jest.fn() };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerProfilesService,
        { provide: getModelToken(WorkerProfile.name), useValue: profileModel },
        { provide: CountriesService, useValue: countriesService },
        { provide: WorkerDocumentsService, useValue: workerDocumentsService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(WorkerProfilesService);
  });

  describe('upsertOwn', () => {
    const dto = { countryId: 'country-1', cityId: 'city-1' };

    it('creates a new profile when none exists (defaults to DRAFT via the schema, untouched here)', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      profileModel.create.mockResolvedValue({ id: 'profile-1' });

      await service.upsertOwn('user-1', dto);

      expect(profileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', countryId: 'country-1', cityId: 'city-1' }),
      );
      expect(profileModel.create.mock.calls[0][0]).not.toHaveProperty('verificationStatus');
    });

    it('updates an existing profile without touching verificationStatus', async () => {
      const existing = {
        verificationStatus: VerificationStatus.APPROVED,
        bio: {},
        yearsOfExperience: 2,
        languages: [],
        serviceAreas: [],
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.upsertOwn('user-1', { ...dto, yearsOfExperience: 5 });

      expect(existing.set).toHaveBeenCalledWith(expect.objectContaining({ yearsOfExperience: 5 }));
      expect(existing.set.mock.calls[0][0]).not.toHaveProperty('verificationStatus');
      expect(existing.save).toHaveBeenCalled();
      // Never mutated directly in-memory either.
      expect(existing.verificationStatus).toBe(VerificationStatus.APPROVED);
    });

    it('validates the country exists and is active before writing anything', async () => {
      countriesService.findActiveById.mockRejectedValue(new NotFoundException('no such country'));
      await expect(service.upsertOwn('user-1', dto)).rejects.toThrow(NotFoundException);
      expect(profileModel.create).not.toHaveBeenCalled();
    });
  });

  describe('getOwn', () => {
    it('throws NotFoundException when the user has no profile', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.getOwn('user-1')).rejects.toThrow(NotFoundException);
    });

    it('excludes soft-deleted profiles', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.getOwn('user-1')).rejects.toThrow();
      expect(profileModel.findOne).toHaveBeenCalledWith({ userId: 'user-1', isDeleted: false });
    });
  });

  describe('setAvailability', () => {
    it('toggles isAvailable regardless of verification status', async () => {
      const profile = { isAvailable: false, save: jest.fn().mockResolvedValue(undefined) };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.setAvailability('user-1', true);

      expect(profile.isAvailable).toBe(true);
      expect(profile.save).toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    function draftProfile() {
      return {
        id: 'profile-1',
        _id: 'profile-1',
        userId: 'user-1',
        countryId: { toString: () => 'country-1' },
        verificationStatus: VerificationStatus.DRAFT,
        rejectionReason: { en: 'old reason' },
        save: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('rejects an illegal transition before even checking documents', async () => {
      const profile = { ...draftProfile(), verificationStatus: VerificationStatus.APPROVED };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await expect(service.submit('user-1')).rejects.toThrow(BadRequestException);
      expect(workerDocumentsService.hasAllRequiredDocuments).not.toHaveBeenCalled();
    });

    it('rejects submission when required documents are incomplete', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(draftProfile()) });
      workerDocumentsService.hasAllRequiredDocuments.mockResolvedValue(false);

      await expect(service.submit('user-1')).rejects.toThrow(
        /missing or rejected required documents/,
      );
    });

    it("looks up required document types for the worker's own country", async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(draftProfile()) });
      workerDocumentsService.hasAllRequiredDocuments.mockResolvedValue(true);

      await service.submit('user-1');

      expect(countriesService.findActiveById).toHaveBeenCalledWith('country-1');
      expect(workerDocumentsService.hasAllRequiredDocuments).toHaveBeenCalledWith('profile-1', [
        DocumentType.NATIONAL_ID_FRONT,
        DocumentType.NATIONAL_ID_BACK,
        DocumentType.CRIMINAL_RECORD,
      ]);
    });

    it('transitions to PENDING_REVIEW and clears any stale rejectionReason when complete', async () => {
      const profile = draftProfile();
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });
      workerDocumentsService.hasAllRequiredDocuments.mockResolvedValue(true);

      await service.submit('user-1');

      expect(profile.verificationStatus).toBe(VerificationStatus.PENDING_REVIEW);
      expect(profile.rejectionReason).toBeNull();
      expect(profile.save).toHaveBeenCalled();
    });

    it('allows resubmission from REJECTED', async () => {
      const profile = { ...draftProfile(), verificationStatus: VerificationStatus.REJECTED };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });
      workerDocumentsService.hasAllRequiredDocuments.mockResolvedValue(true);

      await service.submit('user-1');

      expect(profile.verificationStatus).toBe(VerificationStatus.PENDING_REVIEW);
    });
  });

  describe('listForAdmin', () => {
    it('filters by status when given', async () => {
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.listForAdmin({
        status: VerificationStatus.PENDING_REVIEW,
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(profileModel.find).toHaveBeenCalledWith({
        verificationStatus: VerificationStatus.PENDING_REVIEW,
      });
    });

    it('lists everything (no isDeleted filter) when no status is given', async () => {
      profileModel.find.mockReturnValue(chainable([]));
      profileModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.listForAdmin({ page: 1, limit: 20, skip: 0 } as never);

      expect(profileModel.find).toHaveBeenCalledWith({});
    });
  });

  describe('getForAdmin', () => {
    it('throws NotFoundException when missing', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.getForAdmin('profile-1')).rejects.toThrow(NotFoundException);
    });

    it('does not filter by isDeleted — admin can see soft-deleted profiles too', async () => {
      profileModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      });
      await service.getForAdmin('profile-1');
      expect(profileModel.findOne).toHaveBeenCalledWith({ _id: 'profile-1' });
    });
  });

  describe('reviewWorker', () => {
    function pendingProfile() {
      return {
        verificationStatus: VerificationStatus.PENDING_REVIEW,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        save: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('approves and records WORKER_APPROVED with correct from/to metadata', async () => {
      const profile = pendingProfile();
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.reviewWorker('admin-1', 'profile-1', { action: 'approve' });

      expect(profile.verificationStatus).toBe(VerificationStatus.APPROVED);
      expect(profile.rejectionReason).toBeNull();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.WORKER_APPROVED,
          metadata: { from: VerificationStatus.PENDING_REVIEW, to: VerificationStatus.APPROVED },
        }),
      );
    });

    it('rejects an approval attempt without a reason requirement, but requires one to reject', async () => {
      const profile = pendingProfile();
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await expect(
        service.reviewWorker('admin-1', 'profile-1', { action: 'reject' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with a reason and records WORKER_REJECTED', async () => {
      const profile = pendingProfile();
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.reviewWorker('admin-1', 'profile-1', {
        action: 'reject',
        reason: { en: 'blurry ID' },
      });

      expect(profile.verificationStatus).toBe(VerificationStatus.REJECTED);
      expect(profile.rejectionReason).toEqual({ en: 'blurry ID' });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.WORKER_REJECTED }),
      );
    });

    it('rejects an illegal transition (e.g. suspending a DRAFT worker) before mutating anything', async () => {
      const profile = { ...pendingProfile(), verificationStatus: VerificationStatus.DRAFT };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await expect(
        service.reviewWorker('admin-1', 'profile-1', { action: 'suspend' }),
      ).rejects.toThrow(BadRequestException);
      expect(profile.save).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('suspends an APPROVED worker and records WORKER_SUSPENDED', async () => {
      const profile = { ...pendingProfile(), verificationStatus: VerificationStatus.APPROVED };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.reviewWorker('admin-1', 'profile-1', {
        action: 'suspend',
        reason: { en: 'complaint' },
      });

      expect(profile.verificationStatus).toBe(VerificationStatus.SUSPENDED);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.WORKER_SUSPENDED }),
      );
    });

    it('reinstates a SUSPENDED worker via the same "approve" action', async () => {
      const profile = { ...pendingProfile(), verificationStatus: VerificationStatus.SUSPENDED };
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.reviewWorker('admin-1', 'profile-1', { action: 'approve' });

      expect(profile.verificationStatus).toBe(VerificationStatus.APPROVED);
    });

    it('stamps reviewedBy and reviewedAt', async () => {
      const profile = pendingProfile();
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });

      await service.reviewWorker('admin-1', 'profile-1', { action: 'approve' });

      expect(profile.reviewedBy).toBe('admin-1');
      expect(profile.reviewedAt).toBeInstanceOf(Date);
    });
  });
});
