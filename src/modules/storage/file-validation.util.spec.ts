import sharp from 'sharp';
import {
  computeChecksum,
  detectMimeTypeFromMagicBytes,
  stripImageMetadata,
} from './file-validation.util';

describe('detectMimeTypeFromMagicBytes', () => {
  it('detects a JPEG from its magic bytes', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMimeTypeFromMagicBytes(buffer)).toBe('image/jpeg');
  });

  it('detects a PNG from its magic bytes', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectMimeTypeFromMagicBytes(buffer)).toBe('image/png');
  });

  it('detects a PDF from its magic bytes', () => {
    const buffer = Buffer.from('%PDF-1.4\n', 'ascii');
    expect(detectMimeTypeFromMagicBytes(buffer)).toBe('application/pdf');
  });

  it('returns null for an unrecognized type', () => {
    const buffer = Buffer.from('just some text, not a real file', 'ascii');
    expect(detectMimeTypeFromMagicBytes(buffer)).toBeNull();
  });

  it('is not fooled by a .jpg filename on non-JPEG bytes', () => {
    // The whole point: detection must ignore any claimed extension/Content-Type
    // and look only at the bytes. There's no filename param here at all —
    // this test documents that the function has no way to be fooled by one.
    const buffer = Buffer.from('%PDF-1.4\n', 'ascii');
    expect(detectMimeTypeFromMagicBytes(buffer)).toBe('application/pdf');
  });

  it('returns null for a buffer too short to contain any signature', () => {
    expect(detectMimeTypeFromMagicBytes(Buffer.from([0xff]))).toBeNull();
    expect(detectMimeTypeFromMagicBytes(Buffer.alloc(0))).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  async function jpegWithExif(): Promise<Buffer> {
    return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'should not survive' } } })
      .toBuffer();
  }

  it('removes EXIF metadata from a JPEG', async () => {
    const withExif = await jpegWithExif();
    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();

    const stripped = await stripImageMetadata(withExif, 'image/jpeg');
    const after = await sharp(stripped).metadata();
    expect(after.exif).toBeUndefined();
  });

  it('removes EXIF metadata from a PNG', async () => {
    const withExif = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'should not survive' } } })
      .toBuffer();
    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();

    const stripped = await stripImageMetadata(withExif, 'image/png');
    const after = await sharp(stripped).metadata();
    expect(after.exif).toBeUndefined();
  });

  it('throws on a buffer that is not actually a decodable image', async () => {
    const notAnImage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    await expect(stripImageMetadata(notAnImage, 'image/jpeg')).rejects.toThrow();
  });
});

describe('computeChecksum', () => {
  it('is deterministic sha256 hex', () => {
    const buffer = Buffer.from('hello world');
    const checksum = computeChecksum(buffer);
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(computeChecksum(buffer)).toBe(checksum);
  });

  it('differs for different content', () => {
    expect(computeChecksum(Buffer.from('a'))).not.toBe(computeChecksum(Buffer.from('b')));
  });
});
