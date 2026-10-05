import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { FileStorage } from '../storage/file-storage.interface';
import {
  computeChecksum,
  detectMimeTypeFromMagicBytes,
  stripImageMetadata,
} from '../storage/file-validation.util';
import { generateObjectKey } from '../storage/generate-object-key';
import {
  FILE_STORAGE,
  MAX_FILE_SIZE_BYTES,
  MAX_PRESIGNED_URL_TTL_SECONDS,
} from '../storage/storage.constants';
import { LocalizedText } from './schemas/localized-text.schema';
import {
  VerificationStatus,
  WorkerProfile,
  WorkerProfileDocument,
} from './schemas/worker-profile.schema';
import {
  DocumentReviewStatus,
  DocumentType,
  WorkerDocument,
  WorkerDocumentDocument,
} from './schemas/worker-document.schema';

export interface UploadFileInput {
  buffer: Buffer;
  mimetype: string;
}

export interface PresignedDownload {
  url: string;
  expiresInSeconds: number;
}

const DELETABLE_PROFILE_STATUSES = new Set([VerificationStatus.DRAFT, VerificationStatus.REJECTED]);

@Injectable()
export class WorkerDocumentsService {
  constructor(
    @InjectModel(WorkerDocument.name) private readonly documentModel: Model<WorkerDocumentDocument>,
    @InjectModel(WorkerProfile.name) private readonly profileModel: Model<WorkerProfileDocument>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly auditLogService: AuditLogService,
  ) {}

  async upload(
    workerProfileId: string,
    type: DocumentType,
    file: UploadFileInput,
    expiresAt?: Date,
  ): Promise<WorkerDocumentDocument> {
    if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit`);
    }

    // The client-supplied mimetype/filename is never trusted for anything —
    // only the magic bytes decide what this file actually is.
    const detectedMimeType = detectMimeTypeFromMagicBytes(file.buffer);
    if (!detectedMimeType) {
      throw new BadRequestException('File type not recognized. Allowed: JPEG, PNG, PDF.');
    }

    if (type === DocumentType.CRIMINAL_RECORD && !expiresAt) {
      throw new BadRequestException('expiresAt is required for CRIMINAL_RECORD documents');
    }

    let processedBuffer = file.buffer;
    if (detectedMimeType === 'image/jpeg' || detectedMimeType === 'image/png') {
      try {
        processedBuffer = await stripImageMetadata(file.buffer, detectedMimeType);
      } catch {
        throw new BadRequestException('File claims to be an image but could not be decoded');
      }
    }

    const key = generateObjectKey();
    await this.storage.putObject(key, processedBuffer, detectedMimeType);

    return this.documentModel.create({
      workerProfileId,
      type,
      storageKey: key,
      mimeType: detectedMimeType,
      sizeBytes: processedBuffer.length,
      checksum: computeChecksum(processedBuffer),
      status: DocumentReviewStatus.PENDING,
      expiresAt: expiresAt ?? null,
    });
  }

  async listOwn(workerProfileId: string): Promise<WorkerDocumentDocument[]> {
    return this.documentModel
      .find({ workerProfileId, isDeleted: false })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Hard delete, by design: when she proactively removes a mistaken upload,
   * there's no reason to keep a soft-deleted copy of a sensitive document
   * lying around — real deletion (storage object + DB row) is the more
   * privacy-respecting behavior here. This is the one place WorkerDocument's
   * inherited isDeleted/deletedAt fields go genuinely unused; the retention
   * purge script (purge-documents.ts) performs the same kind of hard delete
   * once a worker's own profile has been gone past the retention window.
   */
  async deleteOwn(workerProfileId: string, documentId: string): Promise<void> {
    const profile = await this.profileModel
      .findOne({ _id: workerProfileId, isDeleted: false })
      .exec();
    if (!profile) {
      throw new NotFoundException('Worker profile not found');
    }
    if (!DELETABLE_PROFILE_STATUSES.has(profile.verificationStatus)) {
      throw new BadRequestException(
        'Documents can only be deleted while the profile is DRAFT or REJECTED',
      );
    }

    const document = await this.documentModel.findOne({ _id: documentId, workerProfileId }).exec();
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.storage.deleteObject(document.storageKey);
    await this.documentModel.deleteOne({ _id: documentId }).exec();
  }

  /** Admin visibility is intentionally unfiltered by isDeleted, consistent with every other admin read in this app. */
  async listForAdmin(workerProfileId: string): Promise<WorkerDocumentDocument[]> {
    return this.documentModel.find({ workerProfileId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Writes the DOCUMENT_VIEWED audit entry BEFORE issuing the presigned URL —
   * not after, not best-effort: if the audit write fails, this throws and no
   * URL is returned. No exceptions, per the spec.
   */
  async getDownloadUrlForAdmin(
    adminUserId: string,
    workerProfileId: string,
    documentId: string,
    context: { ip: string | null; userAgent: string | null },
  ): Promise<PresignedDownload> {
    const document = await this.documentModel.findOne({ _id: documentId, workerProfileId }).exec();
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.DOCUMENT_VIEWED,
      targetType: 'WorkerDocument',
      targetId: documentId,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { workerProfileId, documentType: document.type },
    });

    const url = await this.storage.getPresignedDownloadUrl(
      document.storageKey,
      MAX_PRESIGNED_URL_TTL_SECONDS,
    );
    return { url, expiresInSeconds: MAX_PRESIGNED_URL_TTL_SECONDS };
  }

  async reviewDocument(
    adminUserId: string,
    workerProfileId: string,
    documentId: string,
    decision: 'approve' | 'reject',
    reason?: LocalizedText,
  ): Promise<WorkerDocumentDocument> {
    const document = await this.documentModel.findOne({ _id: documentId, workerProfileId }).exec();
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    document.status =
      decision === 'approve' ? DocumentReviewStatus.APPROVED : DocumentReviewStatus.REJECTED;
    document.rejectionReason = decision === 'reject' ? (reason ?? null) : null;
    document.reviewedBy = adminUserId as unknown as WorkerDocumentDocument['reviewedBy'];
    document.reviewedAt = new Date();
    await document.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action:
        decision === 'approve' ? AuditAction.DOCUMENT_APPROVED : AuditAction.DOCUMENT_REJECTED,
      targetType: 'WorkerDocument',
      targetId: documentId,
      metadata: { workerProfileId },
    });

    return document;
  }

  /**
   * A required type is satisfied by a non-REJECTED document of that type —
   * forcing a resubmission to actually replace whatever an admin flagged,
   * not just re-click submit. CRIMINAL_RECORD additionally requires an
   * unexpired `expiresAt`.
   */
  async hasAllRequiredDocuments(
    workerProfileId: string,
    requiredTypes: DocumentType[],
  ): Promise<boolean> {
    const documents = await this.documentModel.find({ workerProfileId, isDeleted: false }).exec();
    const now = new Date();

    return requiredTypes.every((requiredType) =>
      documents.some(
        (document) =>
          document.type === requiredType &&
          document.status !== DocumentReviewStatus.REJECTED &&
          (requiredType !== DocumentType.CRIMINAL_RECORD ||
            (document.expiresAt !== null && document.expiresAt > now)),
      ),
    );
  }

  /**
   * For the public projection only — deliberately NOT audit-logged. The
   * audit requirement is specifically about admin document review access,
   * not every customer page view of a public profile photo.
   */
  async getApprovedProfilePhotoUrl(workerProfileId: string): Promise<string | null> {
    const document = await this.documentModel
      .findOne({
        workerProfileId,
        type: DocumentType.PROFILE_PHOTO,
        status: DocumentReviewStatus.APPROVED,
        isDeleted: false,
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!document) {
      return null;
    }
    return this.storage.getPresignedDownloadUrl(document.storageKey, MAX_PRESIGNED_URL_TTL_SECONDS);
  }
}
