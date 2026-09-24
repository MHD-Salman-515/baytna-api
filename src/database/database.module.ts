import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongodbUri'),
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        // DNS-class failures (bad SRV/A record, unreachable resolver) are
        // caught before this ever runs — see preflightMongoDns in main.ts and
        // the standalone scripts — so these retries are reserved for
        // genuinely transient errors (a brief network blip, a replica set
        // election), not "the container just isn't up yet" (that's still
        // covered: 3 attempts x 3s comfortably outlasts a `docker compose up`
        // that just fired).
        retryAttempts: 3,
        retryDelay: 3000,
      }),
    }),
  ],
})
export class DatabaseModule {}
