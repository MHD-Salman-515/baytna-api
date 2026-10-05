import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { FILE_STORAGE } from '../storage/storage.constants';
import { VerificationStatus, WorkerProfile } from './schemas/worker-profile.schema';
import {
  DocumentReviewStatus,
  DocumentType,
  WorkerDocument,
} from './schemas/worker-document.schema';
import { WorkerDocumentsService } from './worker-documents.service';

describe('WorkerDocumentsService', () => {
  let service: WorkerDocumentsService;
  let documentModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    deleteOne: jest.Mock;
  };
  let profileModel: { findOne: jest.Mock };
  let storage: {
    putObject: jest.Mock;
    getPresignedDownloadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };

  function chainable(resolvedValue: unknown) {
    const chain: Record<string, jest.Mock> = {};
    ['sort'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
    chain.exec = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  }

  beforeEach(async () => {
    documentModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn(),
    };
    profileModel = { findOne: jest.fn() };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/presigned'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerDocumentsService,
        { provide: getModelToken(WorkerDocument.name), useValue: documentModel },
        { provide: getModelToken(WorkerProfile.name), useValue: profileModel },
        { provide: FILE_STORAGE, useValue: storage },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(WorkerDocumentsService);
  });

  const PDF_BYTES = Buffer.from('%PDF-1.4\n...fake but magic bytes are real', 'ascii');

  async function jpegBuffer(): Promise<Buffer> {
    return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'leaky metadata' } } })
      .toBuffer();
  }

  describe('upload', () => {
    it('rejects a file whose magic bytes are not an allowed type', async () => {
      await expect(
        service.upload('profile-1', DocumentType.OTHER, {
          buffer: Buffer.from('not a real file'),
          mimetype: 'application/pdf',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.putObject).not.toHaveBeenCalled();
    });

    it('rejects a file over the size limit regardless of content', async () => {
      const oversized = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024)]);
      await expect(
        service.upload('profile-1', DocumentType.OTHER, {
          buffer: oversized,
          mimetype: 'application/pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects CRIMINAL_RECORD without an expiresAt', async () => {
      await expect(
        service.upload('profile-1', DocumentType.CRIMINAL_RECORD, {
          buffer: PDF_BYTES,
          mimetype: 'application/pdf',
        }),
      ).rejects.toThrow(/expiresAt is required/);
    });

    it('accepts CRIMINAL_RECORD with an expiresAt and stores it', async () => {
      documentModel.create.mockResolvedValue({ id: 'doc-1' });
      const expiresAt = new Date('2030-01-01');

      await service.upload(
        'profile-1',
        DocumentType.CRIMINAL_RECORD,
        { buffer: PDF_BYTES, mimetype: 'application/pdf' },
        expiresAt,
      );

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: DocumentType.CRIMINAL_RECORD,
          expiresAt,
          mimeType: 'application/pdf',
        }),
      );
    });

    it('strips EXIF metadata from an uploaded JPEG before storing', async () => {
      documentModel.create.mockResolvedValue({ id: 'doc-1' });
      const withExif = await jpegBuffer();

      await service.upload('profile-1', DocumentType.NATIONAL_ID_FRONT, {
        buffer: withExif,
        mimetype: 'image/jpeg',
      });

      const [, storedBuffer] = storage.putObject.mock.calls[0];
      const metadata = await sharp(storedBuffer).metadata();
      expect(metadata.exif).toBeUndefined();
    });

    it('ignores the client-supplied mimetype entirely — only magic bytes decide', async () => {
      documentModel.create.mockResolvedValue({ id: 'doc-1' });
      // Claims to be a PDF via mimetype but the bytes are a PDF anyway — detection must use the bytes, not this field.
      await service.upload('profile-1', DocumentType.OTHER, {
        buffer: PDF_BYTES,
        mimetype: 'image/jpeg',
      });
      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'application/pdf' }),
      );
    });

    it('generates an unguessable key unrelated to any identifying input', async () => {
      documentModel.create.mockResolvedValue({ id: 'doc-1' });
      await service.upload('profile-1', DocumentType.OTHER, {
        buffer: PDF_BYTES,
        mimetype: 'application/pdf',
      });
      const [key] = storage.putObject.mock.calls[0];
      expect(key).toMatch(/^documents\/[a-f0-9]{64}$/);
      expect(key).not.toMatch(/profile-1/);
    });
  });

  describe('listOwn', () => {
    it('scopes strictly to the given workerProfileId and excludes soft-deleted', async () => {
      documentModel.find.mockReturnValue(chainable([]));
      await service.listOwn('profile-1');
      expect(documentModel.find).toHaveBeenCalledWith({
        workerProfileId: 'profile-1',
        isDeleted: false,
      });
    });
  });

  describe('deleteOwn', () => {
    it('throws if the profile does not exist', async () => {
      profileModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.deleteOwn('profile-1', 'doc-1')).rejects.toThrow(NotFoundException);
    });

    it.each([
      VerificationStatus.PENDING_REVIEW,
      VerificationStatus.APPROVED,
      VerificationStatus.SUSPENDED,
    ])('rejects deletion while profile status is %s', async (status) => {
      profileModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ verificationStatus: status }),
      });
      await expect(service.deleteOwn('profile-1', 'doc-1')).rejects.toThrow(BadRequestException);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it.each([VerificationStatus.DRAFT, VerificationStatus.REJECTED])(
      'allows deletion while profile status is %s, removing both storage object and DB row',
      async (status) => {
        profileModel.findOne.mockReturnValue({
          exec: jest.fn().mockResolvedValue({ verificationStatus: status }),
        });
        documentModel.findOne.mockReturnValue({
          exec: jest.fn().mockResolvedValue({ storageKey: 'documents/abc' }),
        });
        documentModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

        await service.deleteOwn('profile-1', 'doc-1');

        expect(storage.deleteObject).toHaveBeenCalledWith('documents/abc');
        expect(documentModel.deleteOne).toHaveBeenCalledWith({ _id: 'doc-1' });
      },
    );

    it('throws if the document does not belong to this workerProfileId (cross-worker isolation)', async () => {
      profileModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ verificationStatus: VerificationStatus.DRAFT }),
      });
      // findOne is called with {_id, workerProfileId} — simulating "no match" the way Mongo would
      // when the document belongs to a different worker's profile.
      documentModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.deleteOwn('profile-1', 'someone-elses-doc')).rejects.toThrow(
        NotFoundException,
      );
      expect(documentModel.findOne).toHaveBeenCalledWith({
        _id: 'someone-elses-doc',
        workerProfileId: 'profile-1',
      });
    });
  });

  describe('getDownloadUrlForAdmin', () => {
    it('writes the audit entry BEFORE requesting the presigned URL', async () => {
      documentModel.findOne.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ storageKey: 'documents/abc', type: DocumentType.NATIONAL_ID_FRONT }),
      });
      const callOrder: string[] = [];
      auditLogService.record.mockImplementation(async () => {
        callOrder.push('audit');
      });
      storage.getPresignedDownloadUrl.mockImplementation(async () => {
        callOrder.push('presign');
        return 'https://example.com/presigned';
      });

      await service.getDownloadUrlForAdmin('admin-1', 'profile-1', 'doc-1', {
        ip: '1.2.3.4',
        userAgent: 'curl',
      });

      expect(callOrder).toEqual(['audit', 'presign']);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: AuditAction.DOCUMENT_VIEWED,
          targetType: 'WorkerDocument',
          targetId: 'doc-1',
        }),
      );
    });

    it('throws without writing an audit entry or requesting a URL when the document does not exist', async () => {
      documentModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        service.getDownloadUrlForAdmin('admin-1', 'profile-1', 'missing-doc', {
          ip: null,
          userAgent: null,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(auditLogService.record).not.toHaveBeenCalled();
      expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('caps the TTL at the 5-minute maximum', async () => {
      documentModel.findOne.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ storageKey: 'documents/abc', type: DocumentType.NATIONAL_ID_FRONT }),
      });

      const result = await service.getDownloadUrlForAdmin('admin-1', 'profile-1', 'doc-1', {
        ip: null,
        userAgent: null,
      });

      expect(result.expiresInSeconds).toBeLessThanOrEqual(300);
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith('documents/abc', 300);
    });
  });

  describe('reviewDocument', () => {
    function mockDocument() {
      return {
        status: DocumentReviewStatus.PENDING,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        save: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('approves a document and records WORKER audit action DOCUMENT_APPROVED', async () => {
      const doc = mockDocument();
      documentModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await service.reviewDocument('admin-1', 'profile-1', 'doc-1', 'approve');

      expect(doc.status).toBe(DocumentReviewStatus.APPROVED);
      expect(doc.rejectionReason).toBeNull();
      expect(doc.save).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.DOCUMENT_APPROVED }),
      );
    });

    it('rejects a document with a reason and records DOCUMENT_REJECTED', async () => {
      const doc = mockDocument();
      documentModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await service.reviewDocument('admin-1', 'profile-1', 'doc-1', 'reject', {
        en: 'blurry',
        ar: 'غير واضح',
      });

      expect(doc.status).toBe(DocumentReviewStatus.REJECTED);
      expect(doc.rejectionReason).toEqual({ en: 'blurry', ar: 'غير واضح' });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.DOCUMENT_REJECTED }),
      );
    });

    it('throws if the document does not exist under that workerProfileId', async () => {
      documentModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(
        service.reviewDocument('admin-1', 'profile-1', 'doc-1', 'approve'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasAllRequiredDocuments', () => {
    const required = [
      DocumentType.NATIONAL_ID_FRONT,
      DocumentType.NATIONAL_ID_BACK,
      DocumentType.CRIMINAL_RECORD,
    ];

    it('is false when a required type is missing entirely', async () => {
      documentModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            type: DocumentType.NATIONAL_ID_FRONT,
            status: DocumentReviewStatus.PENDING,
            expiresAt: null,
          },
        ]),
      });
      expect(await service.hasAllRequiredDocuments('profile-1', required)).toBe(false);
    });

    it('is false when the only document of a required type was REJECTED', async () => {
      documentModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            type: DocumentType.NATIONAL_ID_FRONT,
            status: DocumentReviewStatus.REJECTED,
            expiresAt: null,
          },
          {
            type: DocumentType.NATIONAL_ID_BACK,
            status: DocumentReviewStatus.PENDING,
            expiresAt: null,
          },
          {
            type: DocumentType.CRIMINAL_RECORD,
            status: DocumentReviewStatus.PENDING,
            expiresAt: new Date('2099-01-01'),
          },
        ]),
      });
      expect(await service.hasAllRequiredDocuments('profile-1', required)).toBe(false);
    });

    it('is false when the CRIMINAL_RECORD document has already expired', async () => {
      documentModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            type: DocumentType.NATIONAL_ID_FRONT,
            status: DocumentReviewStatus.PENDING,
            expiresAt: null,
          },
          {
            type: DocumentType.NATIONAL_ID_BACK,
            status: DocumentReviewStatus.PENDING,
            expiresAt: null,
          },
          {
            type: DocumentType.CRIMINAL_RECORD,
            status: DocumentReviewStatus.PENDING,
            expiresAt: new Date('2000-01-01'),
          },
        ]),
      });
      expect(await service.hasAllRequiredDocuments('profile-1', required)).toBe(false);
    });

    it('is true when every required type has a non-rejected (and, for CRIMINAL_RECORD, unexpired) document', async () => {
      documentModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            type: DocumentType.NATIONAL_ID_FRONT,
            status: DocumentReviewStatus.APPROVED,
            expiresAt: null,
          },
          {
            type: DocumentType.NATIONAL_ID_BACK,
            status: DocumentReviewStatus.PENDING,
            expiresAt: null,
          },
          {
            type: DocumentType.CRIMINAL_RECORD,
            status: DocumentReviewStatus.PENDING,
            expiresAt: new Date('2099-01-01'),
          },
        ]),
      });
      expect(await service.hasAllRequiredDocuments('profile-1', required)).toBe(true);
    });
  });

  describe('getApprovedProfilePhotoUrl', () => {
    it('returns null when no approved profile photo exists', async () => {
      documentModel.findOne.mockReturnValue(chainable(null));
      expect(await service.getApprovedProfilePhotoUrl('profile-1')).toBeNull();
      expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns a presigned URL for the approved photo without writing an audit entry', async () => {
      documentModel.findOne.mockReturnValue(chainable({ storageKey: 'documents/photo' }));

      const url = await service.getApprovedProfilePhotoUrl('profile-1');

      expect(url).toBe('https://example.com/presigned');
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith('documents/photo', 300);
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('only ever queries for PROFILE_PHOTO type with APPROVED status', async () => {
      documentModel.findOne.mockReturnValue(chainable(null));
      await service.getApprovedProfilePhotoUrl('profile-1');
      expect(documentModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          type: DocumentType.PROFILE_PHOTO,
          status: DocumentReviewStatus.APPROVED,
        }),
      );
    });
  });
});
