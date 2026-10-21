import { ReportDocument } from './schemas/report.schema';

/**
 * The reporter's own view of her report — a hand-built allowlist, same
 * discipline as every other projection in this app. `internalNotes` is
 * never included here, by construction: there is no code path that reads
 * that field for a non-admin viewer. `assignedTo` is likewise an internal
 * operational detail, not something the reporter needs.
 */
export function toOwnReportView(report: ReportDocument): Record<string, unknown> {
  return {
    id: report.id as string,
    subjectType: report.subjectType,
    subjectId: report.subjectId.toString(),
    bookingId: report.bookingId ? report.bookingId.toString() : null,
    category: report.category,
    description: report.description,
    attachments: report.attachments.map((a) => ({
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedAt: a.uploadedAt,
    })),
    status: report.status,
    resolutionAction: report.resolutionAction,
    resolution: report.resolution,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
  };
}
