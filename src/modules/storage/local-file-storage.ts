import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { FileStorage } from './file-storage.interface';
import { MAX_PRESIGNED_URL_TTL_SECONDS } from './storage.constants';

/**
 * Development default. Writes outside any directory this app serves (it
 * doesn't serve static files at all, but the directory is still kept well
 * away from `dist`/`src` and is gitignored) — see STORAGE_LOCAL_DIR.
 *
 * There's no real presigned-URL mechanism for a local filesystem, so this
 * fakes one the same way S3 does: an HMAC over (key, expiry) using OTP_PEPPER
 * as the signing secret. Reusing that secret is deliberate, not sloppy — this
 * whole mechanism only exists for local development ergonomics (production
 * always uses S3CompatibleStorage against a real bucket), so it doesn't
 * warrant its own dedicated required secret.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly logger = new Logger('LocalFileStorage (DEV ONLY)');
  private readonly baseDir: string;
  private readonly signingSecret: string;
  private readonly publicBaseUrl: string;
  private readonly apiPrefix: string;

  constructor(private readonly configService: ConfigService) {
    this.baseDir = resolve(this.configService.get<string>('storageLocalDir') as string);
    this.signingSecret = this.configService.get<string>('otpPepper') as string;
    this.publicBaseUrl = this.configService.get<string>('publicBaseUrl') as string;
    this.apiPrefix = this.configService.get<string>('apiPrefix') as string;
  }

  async putObject(key: string, body: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolveKeyPath(key);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, body);
  }

  async getPresignedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    const clampedTtl = Math.min(ttlSeconds, MAX_PRESIGNED_URL_TTL_SECONDS);
    const expires = Math.floor(Date.now() / 1000) + clampedTtl;
    const signature = this.sign(key, expires);
    const params = new URLSearchParams({ key, expires: String(expires), sig: signature });
    return `${this.publicBaseUrl}/${this.apiPrefix}/_storage/local-download?${params.toString()}`;
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolveKeyPath(key), { force: true });
  }

  /** Used only by LocalStorageController to validate an incoming download request. */
  async readForSignedRequest(key: string, expires: number, signature: string): Promise<Buffer> {
    const expected = this.sign(key, expires);
    const providedBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const validSignature =
      providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);

    if (!validSignature || Math.floor(Date.now() / 1000) > expires) {
      throw new NotFoundException('Link expired or invalid');
    }

    try {
      return await readFile(this.resolveKeyPath(key));
    } catch {
      throw new NotFoundException('Link expired or invalid');
    }
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}:${expires}`).digest('hex');
  }

  /** Rejects any key that would escape baseDir (defense in depth — keys are always our own crypto-random values, never user input, but this costs nothing). */
  private resolveKeyPath(key: string): string {
    const filePath = resolve(this.baseDir, key);
    if (!filePath.startsWith(this.baseDir)) {
      throw new NotFoundException('Invalid key');
    }
    return filePath;
  }
}
