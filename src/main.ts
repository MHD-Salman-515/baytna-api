import './config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env (in particular, before applyDnsServersFromEnv below)

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { applyDnsServersFromEnv } from './config/apply-dns-servers';
import { preflightMongoDns } from './config/preflight-mongo-dns';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  applyDnsServersFromEnv();
  if (process.env.MONGODB_URI) {
    await preflightMongoDns(process.env.MONGODB_URI);
  }

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('apiPrefix', 'api/v1');
  const corsOrigins = configService.get<string[]>('corsOrigins', ['*']);

  app.setGlobalPrefix(apiPrefix);
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Not required in development — a single instance works fine with
  // socket.io's default in-memory adapter. Only matters once there's more
  // than one instance behind a load balancer (see RedisIoAdapter's own doc comment).
  if (configService.get<boolean>('realtime.redisAdapterEnabled')) {
    const redisUrl = configService.get<string>('redisUrl');
    if (!redisUrl) {
      throw new Error('WEBSOCKET_REDIS_ADAPTER_ENABLED=true requires REDIS_URL to be set');
    }
    const redisIoAdapter = new RedisIoAdapter(app);
    redisIoAdapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(redisIoAdapter);
    Logger.log(
      'Socket.IO Redis adapter enabled — realtime events now fan out across instances',
      'Bootstrap',
    );
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Home Services Marketplace API')
    .setDescription('Backend API for the housekeeper marketplace (Syria & Iraq)')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  Logger.log(`Application running on http://localhost:${port}/${apiPrefix}`, 'Bootstrap');
  Logger.log(`Swagger docs available at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
