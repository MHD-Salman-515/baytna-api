import { BadRequestException, Injectable } from '@nestjs/common';
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { CountriesService } from '../countries/countries.service';
import { CountryDocument } from '../countries/schemas/country.schema';

export interface NormalizedPhone {
  e164: string;
  country: CountryDocument;
}

@Injectable()
export class PhoneValidationService {
  constructor(private readonly countriesService: CountriesService) {}

  /**
   * Validates `rawPhone` against the given country (must be active) and
   * returns its E.164 form. Rejects a number that libphonenumber resolves to
   * a *different* country than the one requested — e.g. a full +1... number
   * submitted with countryId pointing at Syria — rather than silently
   * normalizing it to a country the caller didn't ask for.
   */
  async normalizeForCountry(rawPhone: string, countryId: string): Promise<NormalizedPhone> {
    const country = await this.countriesService.findActiveById(countryId);

    const parsed = parsePhoneNumberFromString(rawPhone, country.code as CountryCode);
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException('Invalid phone number for the given country');
    }
    if (parsed.country !== country.code) {
      throw new BadRequestException('Phone number does not belong to the specified country');
    }

    return { e164: parsed.number, country };
  }

  /** Infers the country directly from a full E.164 number — used by the admin seeder, which has no countryId to hand it. */
  async resolveCountryForE164(e164Phone: string): Promise<NormalizedPhone> {
    const parsed = parsePhoneNumberFromString(e164Phone);
    if (!parsed || !parsed.isValid() || !parsed.country) {
      throw new BadRequestException(`Not a valid E.164 phone number: ${e164Phone}`);
    }

    const activeCountries = await this.countriesService.findActive();
    const country = activeCountries.find((c) => c.code === parsed.country);
    if (!country) {
      throw new BadRequestException(
        `Phone country "${parsed.country}" has no matching active entry in the countries collection`,
      );
    }

    return { e164: parsed.number, country };
  }
}
