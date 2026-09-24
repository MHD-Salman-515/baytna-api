import './config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env (in particular, before applyDnsServersFromEnv below)

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { applyDnsServersFromEnv } from './config/apply-dns-servers';
import { preflightMongoDns } from './config/preflight-mongo-dns';
import { AppModule } from './app.module';

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Home Services Marketplace API')
    .setDescription('Backend API for the housekeeper marketplace (Syria & Iraq)')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-admin-key', in: 'header' }, 'admin-key')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  Logger.log(`Application running on http://localhost:${port}/${apiPrefix}`, 'Bootstrap');
  Logger.log(`Swagger docs available at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
