import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileStorage } from './file-storage.interface';
import { MAX_PRESIGNED_URL_TTL_SECONDS } from './storage.constants';

export interface S3CompatibleStorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for R2/B2/MinIO; omit for real AWS S3. */
  endpoint?: string;
  /** Some S3-compatible providers need path-style URLs instead of virtual-hosted-style. */
  forcePathStyle?: boolean;
}

/**
 * Plain S3 API only (no provider-specific SDKs) so Cloudflare R2, Backblaze
 * B2, MinIO, or real AWS S3 all work by config change alone — see
 * storage.module.ts for the env vars that select this over LocalFileStorage.
 */
export class S3CompatibleStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3CompatibleStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getPresignedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const clampedTtl = Math.min(ttlSeconds, MAX_PRESIGNED_URL_TTL_SECONDS);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: clampedTtl });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
