/**
 * Private object storage, behind one interface so the app never cares whether
 * it's talking to local disk (dev) or an S3-compatible bucket (prod). No
 * implementation may expose a public URL — every read is a short-lived
 * presigned URL, generated per request, capped at MAX_PRESIGNED_URL_TTL_SECONDS.
 */
export interface FileStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** ttlSeconds must never exceed MAX_PRESIGNED_URL_TTL_SECONDS — implementations should clamp, not trust the caller. */
  getPresignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
