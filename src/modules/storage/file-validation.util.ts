import { createHash } from 'crypto';
import sharp from 'sharp';
import { AllowedMimeType } from './storage.constants';

/**
 * Sniffs the real file type from its leading bytes — never trust the
 * client-supplied Content-Type or filename extension, both of which are
 * just strings the caller chose and can lie about.
 */
export function detectMimeTypeFromMagicBytes(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }

  return null;
}

/**
 * Re-encodes the image via sharp, which drops EXIF/ICC/XMP metadata by
 * default unless .withMetadata() is explicitly called (it never is here) —
 * this is what actually strips GPS coordinates and similar from a photo of
 * an ID card taken at home. Also doubles as a decodability check: a buffer
 * that merely starts with the right magic bytes but isn't a real, complete
 * image throws here rather than getting stored.
 */
export async function stripImageMetadata(
  buffer: Buffer,
  mimeType: 'image/jpeg' | 'image/png',
): Promise<Buffer> {
  const image = sharp(buffer);
  return mimeType === 'image/jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer();
}

export function computeChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
