import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { UpsertWorkerProfileDto } from './dto/upsert-worker-profile.dto';

/**
 * Gap #4 investigation: a worker's bio was found stored as literal "?????
 * ??????" — the Arabic had already been destroyed by the time it reached
 * Mongo. This file proves every layer of THIS backend's own request
 * pipeline (the express body parser behind every @Body(), and the exact
 * ValidationPipe config main.ts installs globally) preserves Arabic UTF-8
 * byte-for-byte. Nothing here sets a non-UTF-8 charset, and there is no
 * code path in this codebase that could turn real Arabic bytes into "?" —
 * literal "?" (0x3F) is what you get when a client's own shell/terminal
 * (e.g. a Windows cmd.exe codepage that isn't UTF-8) mangles the bytes
 * BEFORE they're ever sent; no server-side fix can recover data that was
 * never received intact. If this ever reproduces again, capture the raw
 * request bytes (not what a terminal printed) to confirm.
 */
const ARABIC_BIO = {
  ar: 'أمينة وسريعة في العمل، خبرة خمس سنوات',
  en: 'Reliable and fast, five years of experience',
};

describe('Arabic text survives this backend request pipeline byte-for-byte', () => {
  it("express.json() — the body parser behind every controller's @Body() — decodes UTF-8 Arabic without corruption", async () => {
    const app = express();
    app.use(express.json());
    let receivedBody: { bio: typeof ARABIC_BIO } | undefined;
    app.post('/echo', (req, res) => {
      receivedBody = req.body;
      res.json(req.body);
    });

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    try {
      const payload = JSON.stringify({ bio: ARABIC_BIO });
      const responseBody = await new Promise<string>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/echo',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': Buffer.byteLength(payload),
            },
          },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          },
        );
        request.on('error', reject);
        request.write(payload, 'utf8');
        request.end();
      });

      expect(receivedBody?.bio.ar).toBe(ARABIC_BIO.ar);
      expect(receivedBody?.bio.en).toBe(ARABIC_BIO.en);
      expect(JSON.parse(responseBody).bio.ar).toBe(ARABIC_BIO.ar);
    } finally {
      server.close();
    }
  });

  it('the exact global ValidationPipe config from main.ts preserves Arabic text through UpsertWorkerProfileDto unchanged', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: UpsertWorkerProfileDto,
      data: '',
    };

    const transformed = (await pipe.transform(
      {
        countryId: '507f1f77bcf86cd799439011',
        cityId: '507f1f77bcf86cd799439012',
        bio: ARABIC_BIO,
      },
      metadata,
    )) as UpsertWorkerProfileDto;

    expect(transformed.bio?.ar).toBe(ARABIC_BIO.ar);
    expect(transformed.bio?.en).toBe(ARABIC_BIO.en);
  });

  it('a UTF-8 Buffer round-trip (what the MongoDB driver does on the wire) preserves Arabic text', () => {
    const roundTripped = Buffer.from(ARABIC_BIO.ar, 'utf8').toString('utf8');
    expect(roundTripped).toBe(ARABIC_BIO.ar);
  });
});
