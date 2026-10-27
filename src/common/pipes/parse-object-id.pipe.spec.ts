import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();
  const metadata = { type: 'param', data: 'id' } as const;

  it('passes through a real 24-hex-char ObjectId unchanged', () => {
    const id = new Types.ObjectId().toString();
    expect(pipe.transform(id, metadata)).toBe(id);
  });

  it('throws NotFoundException — not a 500 — for a malformed id', () => {
    expect(() => pipe.transform('not-an-id', metadata)).toThrow(NotFoundException);
  });

  it('throws NotFoundException for an empty string', () => {
    expect(() => pipe.transform('', metadata)).toThrow(NotFoundException);
  });

  it('throws NotFoundException for a hex string of the wrong length', () => {
    expect(() => pipe.transform('abc123', metadata)).toThrow(NotFoundException);
  });
});
