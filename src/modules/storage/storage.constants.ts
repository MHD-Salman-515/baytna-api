export const FILE_STORAGE = Symbol('FILE_STORAGE');

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Hard cap per the spec — callers must never request longer than this. */
export const MAX_PRESIGNED_URL_TTL_SECONDS = 300; // 5 minutes
