import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { LocalFileStorage } from './local-file-storage';

/**
 * Dev-only stand-in for what an S3 presigned GET URL does natively: a
 * time-limited, signature-gated download link that needs no further app
 * auth (the signature IS the auth — same trust model as S3). Never used
 * when S3CompatibleStorage is active; see storage.module.ts.
 */
@ApiExcludeController()
@Controller('_storage')
export class LocalStorageController {
  constructor(private readonly localFileStorage: LocalFileStorage) {}

  @Public()
  @Get('local-download')
  async download(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.localFileStorage.readForSignedRequest(key, Number(expires), sig);
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
