import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { applyDnsServersFromEnv } from '../../config/apply-dns-servers';
import { preflightMongoDns } from '../../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../../config/redact-connection-string';
import { AppModule } from '../../app.module';
import { City, CityDocument } from '../../modules/cities/schemas/city.schema';
import { Country, CountryDocument } from '../../modules/countries/schemas/country.schema';
import { PhoneValidationService } from '../../modules/users/phone-validation.service';
import { UsersService } from '../../modules/users/users.service';
import { citiesSeedData } from './cities.seed-data';
import { countriesSeedData } from './countries.seed-data';
import { assertLocalMongoUri } from './seed-guard';
import { UpsertOutcome, upsertWithOutcome } from './upsert-with-outcome';

const logger = new Logger('Seeder');

function summarize(label: string, outcomes: UpsertOutcome[]): void {
  const counts = { created: 0, updated: 0, unchanged: 0 };
  for (const outcome of outcomes) counts[outcome]++;
  logger.log(
    `${label}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
  );
}

async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  assertLocalMongoUri(process.env.MONGODB_URI as string);
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    logger.log(`Seeding against ${describeConfiguredMongoUri()}`);

    const countryModel = app.get<Model<CountryDocument>>(getModelToken(Country.name));
    const cityModel = app.get<Model<CityDocument>>(getModelToken(City.name));

    const countryIdByCode = new Map<string, string>();
    const countryOutcomes: UpsertOutcome[] = [];

    const countryFields = [
      'name',
      'currencyCode',
      'phonePrefix',
      'enabledPaymentMethods',
      'commissionRate',
      'isActive',
    ];

    for (const country of countriesSeedData) {
      const { code, ...payload } = country;
      const outcome = await upsertWithOutcome(
        countryModel,
        { code, isDeleted: false },
        payload,
        countryFields,
      );
      countryOutcomes.push(outcome);

      const doc = await countryModel.findOne({ code, isDeleted: false }).exec();
      countryIdByCode.set(code, doc!._id.toString());
      logger.log(`Country ${code}: ${outcome}`);
    }

    const cityFields = ['name', 'center', 'isActive'];
    const cityOutcomes: UpsertOutcome[] = [];

    for (const city of citiesSeedData) {
      const countryId = countryIdByCode.get(city.countryCode);
      if (!countryId) {
        logger.warn(`Skipping city ${city.name.en}: unknown country code ${city.countryCode}`);
        continue;
      }

      const outcome = await upsertWithOutcome(
        cityModel,
        { countryId, 'name.en': city.name.en, isDeleted: false },
        { countryId, name: city.name, center: city.center, isActive: true },
        cityFields,
      );
      cityOutcomes.push(outcome);
      logger.log(`City ${city.name.en}: ${outcome}`);
    }

    summarize('Countries', countryOutcomes);
    summarize('Cities', cityOutcomes);

    const seedAdminPhone = process.env.SEED_ADMIN_PHONE;
    if (!seedAdminPhone) {
      logger.warn(
        'SEED_ADMIN_PHONE not set — skipping admin user seeding (no ADMIN account will exist)',
      );
    } else {
      const phoneValidationService = app.get(PhoneValidationService);
      const usersService = app.get(UsersService);
      const { e164, country } = await phoneValidationService.resolveCountryForE164(seedAdminPhone);
      const { outcome } = await usersService.upsertAdmin(e164, country.id as string);
      logger.log(`Admin user ${e164} (${country.code}): ${outcome}`);
    }

    logger.log('Seeding complete');
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
