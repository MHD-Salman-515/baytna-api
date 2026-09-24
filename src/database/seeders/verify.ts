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
import { citiesSeedData } from './cities.seed-data';
import { countriesSeedData } from './countries.seed-data';
import { assertLocalMongoUri } from './seed-guard';

const logger = new Logger('SeedVerify');

interface RawIndex {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

function hasIndex(
  indexes: RawIndex[],
  matches: (index: RawIndex) => boolean,
  description: string,
): boolean {
  const found = indexes.some(matches);
  logger.log(`  [${found ? 'OK' : 'MISSING'}] ${description}`);
  return found;
}

async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  assertLocalMongoUri(process.env.MONGODB_URI as string);
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let ok = true;

  try {
    logger.log(`Verifying against ${describeConfiguredMongoUri()}`);

    const countryModel = app.get<Model<CountryDocument>>(getModelToken(Country.name));
    const cityModel = app.get<Model<CityDocument>>(getModelToken(City.name));

    const countryCount = await countryModel.countDocuments({}).exec();
    const cityCount = await cityModel.countDocuments({}).exec();

    logger.log(
      `countries: ${countryCount} document(s) (seed data has ${countriesSeedData.length})`,
    );
    logger.log(`cities: ${cityCount} document(s) (seed data has ${citiesSeedData.length})`);

    if (countryCount < countriesSeedData.length) {
      logger.error(
        'countries collection has fewer documents than the seed data — did seeding run?',
      );
      ok = false;
    }
    if (cityCount < citiesSeedData.length) {
      logger.error('cities collection has fewer documents than the seed data — did seeding run?');
      ok = false;
    }

    const countryIndexes = (await countryModel.collection.indexes()) as unknown as RawIndex[];
    const cityIndexes = (await cityModel.collection.indexes()) as unknown as RawIndex[];

    logger.log('countries.getIndexes():');
    logger.log(JSON.stringify(countryIndexes, null, 2));
    logger.log('cities.getIndexes():');
    logger.log(JSON.stringify(cityIndexes, null, 2));

    logger.log('Checking required indexes:');
    const hasCountryCodeIndex = hasIndex(
      countryIndexes,
      (idx) =>
        idx.key.code === 1 &&
        idx.unique === true &&
        idx.partialFilterExpression?.isDeleted === false,
      'countries: unique partial index on { code: 1 } where isDeleted: false',
    );
    const hasCityGeoIndex = hasIndex(
      cityIndexes,
      (idx) => idx.key.center === '2dsphere',
      "cities: 2dsphere index on { center: '2dsphere' }",
    );
    const hasCityCountryIndex = hasIndex(
      cityIndexes,
      (idx) => idx.key.countryId === 1,
      'cities: index with { countryId: 1 } (leading key)',
    );

    ok = ok && hasCountryCodeIndex && hasCityGeoIndex && hasCityCountryIndex;
  } finally {
    await app.close();
  }

  if (!ok) {
    logger.error('Verification FAILED');
    process.exit(1);
  }
  logger.log('Verification PASSED');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
