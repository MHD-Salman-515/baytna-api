import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorage } from './file-storage.interface';
import { LocalFileStorage } from './local-file-storage';
import { LocalStorageController } from './local-storage.controller';
import { S3CompatibleStorage } from './s3-compatible-storage';
import { FILE_STORAGE } from './storage.constants';

@Module({
  controllers: [LocalStorageController],
  providers: [
    LocalFileStorage,
    {
      provide: FILE_STORAGE,
      useFactory: (configService: ConfigService, localFileStorage: LocalFileStorage): FileStorage => {
        const bucket = configService.get<string>('s3.bucket');
        if (!bucket) {
          return localFileStorage;
        }
        return new S3CompatibleStorage({
          bucket,
          region: configService.get<string>('s3.region') as string,
          accessKeyId: configService.get<string>('s3.accessKeyId') as string,
          secretAccessKey: configService.get<string>('s3.secretAccessKey') as string,
          endpoint: configService.get<string>('s3.endpoint'),
          forcePathStyle: configService.get<boolean>('s3.forcePathStyle'),
        });
      },
      inject: [ConfigService, LocalFileStorage],
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
