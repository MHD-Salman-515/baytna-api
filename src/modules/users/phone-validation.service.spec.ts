import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CountriesService } from '../countries/countries.service';
import { PhoneValidationService } from './phone-validation.service';

describe('PhoneValidationService', () => {
  let service: PhoneValidationService;
  let countriesService: { findActiveById: jest.Mock; findActive: jest.Mock };

  const syria = { code: 'SY', phonePrefix: '+963' };
  const iraq = { code: 'IQ', phonePrefix: '+964' };

  beforeEach(async () => {
    countriesService = {
      findActiveById: jest.fn(),
      findActive: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PhoneValidationService, { provide: CountriesService, useValue: countriesService }],
    }).compile();

    service = module.get<PhoneValidationService>(PhoneValidationService);
  });

  describe('normalizeForCountry', () => {
    it('normalizes a local-format number to E.164 for the given country', async () => {
      countriesService.findActiveById.mockResolvedValue(syria);

      const result = await service.normalizeForCountry('0911111111', 'sy-id');

      expect(result.e164).toBe('+963911111111');
      expect(result.country).toBe(syria);
    });

    it('accepts an already-E.164 number matching the given country', async () => {
      countriesService.findActiveById.mockResolvedValue(syria);

      const result = await service.normalizeForCountry('+963911111111', 'sy-id');

      expect(result.e164).toBe('+963911111111');
    });

    it('rejects an unparseable number', async () => {
      countriesService.findActiveById.mockResolvedValue(syria);

      await expect(service.normalizeForCountry('not-a-phone', 'sy-id')).rejects.toThrow(BadRequestException);
    });

    it('rejects a number that resolves to a different country than requested', async () => {
      countriesService.findActiveById.mockResolvedValue(syria);

      // Fully-qualified Iraqi number submitted while claiming countryId=Syria.
      await expect(service.normalizeForCountry('+964711111111', 'sy-id')).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException for an inactive/unknown country', async () => {
      countriesService.findActiveById.mockRejectedValue(new NotFoundException());

      await expect(service.normalizeForCountry('0911111111', 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveCountryForE164', () => {
    it('finds the matching active country for a valid E.164 number', async () => {
      countriesService.findActive.mockResolvedValue([syria, iraq]);

      const result = await service.resolveCountryForE164('+963911111111');

      expect(result.e164).toBe('+963911111111');
      expect(result.country).toBe(syria);
    });

    it('rejects when no active country matches the phone', async () => {
      countriesService.findActive.mockResolvedValue([iraq]);

      await expect(service.resolveCountryForE164('+963911111111')).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid E.164 string', async () => {
      await expect(service.resolveCountryForE164('not-e164')).rejects.toThrow(BadRequestException);
    });
  });
});
