import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { CountriesService } from '../countries/countries.service';
import { ServicesService } from '../services/services.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { WorkerServicesService } from '../workers/worker-services.service';
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  let service: PricingService;
  let workerServicesService: { findActiveById: jest.Mock };
  let workerProfilesService: { findApprovedById: jest.Mock };
  let servicesService: { findActiveById: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };

  const approvedProfile = { countryId: { toString: () => 'country-1' } };
  const country = { currencyCode: 'SYP', commissionRate: 1500 };

  beforeEach(async () => {
    workerServicesService = { findActiveById: jest.fn() };
    workerProfilesService = { findApprovedById: jest.fn().mockResolvedValue(approvedProfile) };
    servicesService = {
      findActiveById: jest.fn().mockResolvedValue({ key: 'CLEANING', commissionRate: null }),
    };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(country) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: WorkerServicesService, useValue: workerServicesService },
        { provide: WorkerProfilesService, useValue: workerProfilesService },
        { provide: ServicesService, useValue: servicesService },
        { provide: CountriesService, useValue: countriesService },
      ],
    }).compile();

    service = module.get(PricingService);
  });

  function workerService(overrides: Record<string, unknown> = {}) {
    return {
      workerProfileId: { toString: () => 'profile-1' },
      serviceId: { toString: () => 'service-1' },
      pricingType: PricingType.FIXED,
      hourly: null,
      bySize: null,
      fixed: { price: 10000 },
      currency: 'SYP',
      ...overrides,
    };
  }

  describe('visibility gate', () => {
    it('throws NotFoundException if the worker profile is not APPROVED/available — never reveals why', async () => {
      workerServicesService.findActiveById.mockResolvedValue(workerService());
      workerProfilesService.findApprovedById.mockResolvedValue(null);
      await expect(service.quote('ws-1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('FIXED', () => {
    it('returns the flat price as basePrice', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({ fixed: { price: 7000 } }),
      );
      const quote = await service.quote('ws-1', {});
      expect(quote.basePrice).toBe(7000);
      expect(quote.currency).toBe('SYP');
    });
  });

  describe('HOURLY', () => {
    it('uses minHours when no estimate is given', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({
          pricingType: PricingType.HOURLY,
          hourly: { rate: 1000, minHours: 3 },
          fixed: null,
        }),
      );
      const quote = await service.quote('ws-1', {});
      expect(quote.basePrice).toBe(3000); // 1000 * 3
      expect(quote.breakdown.hours).toBe(3);
    });

    it('clamps an estimate below minHours up to minHours', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({
          pricingType: PricingType.HOURLY,
          hourly: { rate: 1000, minHours: 3 },
          fixed: null,
        }),
      );
      const quote = await service.quote('ws-1', { estimatedHours: 1 });
      expect(quote.basePrice).toBe(3000);
      expect(quote.breakdown.hours).toBe(3);
    });

    it('uses the given estimate when it meets or exceeds minHours', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({
          pricingType: PricingType.HOURLY,
          hourly: { rate: 1000, minHours: 2 },
          fixed: null,
        }),
      );
      const quote = await service.quote('ws-1', { estimatedHours: 5 });
      expect(quote.basePrice).toBe(5000);
      expect(quote.breakdown.hours).toBe(5);
    });
  });

  describe('BY_SIZE', () => {
    const bySizeWorkerService = workerService({
      pricingType: PricingType.BY_SIZE,
      bySize: {
        tiers: [
          { maxRooms: 2, price: 2000 },
          { maxRooms: 5, price: 4000 },
        ],
      },
      fixed: null,
    });

    it('requires roomCount', async () => {
      workerServicesService.findActiveById.mockResolvedValue(bySizeWorkerService);
      await expect(service.quote('ws-1', {})).rejects.toThrow(/roomCount is required/);
    });

    it('resolves the correct tier for a room count within the first tier', async () => {
      workerServicesService.findActiveById.mockResolvedValue(bySizeWorkerService);
      const quote = await service.quote('ws-1', { roomCount: 1 });
      expect(quote.basePrice).toBe(2000);
    });

    it('resolves the correct tier for a room count in a higher tier', async () => {
      workerServicesService.findActiveById.mockResolvedValue(bySizeWorkerService);
      const quote = await service.quote('ws-1', { roomCount: 4 });
      expect(quote.basePrice).toBe(4000);
    });

    it('rejects a room count above the highest tier with a clear message naming the max', async () => {
      workerServicesService.findActiveById.mockResolvedValue(bySizeWorkerService);
      await expect(service.quote('ws-1', { roomCount: 10 })).rejects.toThrow(
        /exceeds the highest tier \(max 5 rooms\)/,
      );
    });
  });

  describe('commission fallback', () => {
    it('uses the service commissionRate when present', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({ fixed: { price: 10000 } }),
      );
      servicesService.findActiveById.mockResolvedValue({ key: 'CLEANING', commissionRate: 2000 });

      const quote = await service.quote('ws-1', {});

      expect(quote.breakdown.commissionRateBasisPoints).toBe(2000);
      expect(quote.commissionAmount).toBe(2000); // 20% of 10000
      expect(quote.workerEarnings).toBe(8000);
    });

    it('falls back to the country commissionRate when the service has none', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({ fixed: { price: 10000 } }),
      );
      servicesService.findActiveById.mockResolvedValue({ key: 'CLEANING', commissionRate: null });
      countriesService.findActiveById.mockResolvedValue({
        currencyCode: 'SYP',
        commissionRate: 1500,
      });

      const quote = await service.quote('ws-1', {});

      expect(quote.breakdown.commissionRateBasisPoints).toBe(1500);
      expect(quote.commissionAmount).toBe(1500); // 15% of 10000
      expect(quote.workerEarnings).toBe(8500);
    });

    it('always satisfies commission + earnings === basePrice', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({ fixed: { price: 9999 } }),
      );
      servicesService.findActiveById.mockResolvedValue({ key: 'CLEANING', commissionRate: 3333 });

      const quote = await service.quote('ws-1', {});

      expect(quote.commissionAmount + quote.workerEarnings).toBe(quote.basePrice);
    });
  });

  describe('recomputeFinal', () => {
    it('runs the same calculation as quote(), labeled "final"', async () => {
      workerServicesService.findActiveById.mockResolvedValue(
        workerService({
          pricingType: PricingType.HOURLY,
          hourly: { rate: 1000, minHours: 1 },
          fixed: null,
        }),
      );
      const quote = await service.recomputeFinal('ws-1', { estimatedHours: 4 });
      expect(quote.basePrice).toBe(4000);
      expect(quote.breakdown.mode).toBe('final');
    });
  });

  describe('estimate mode label', () => {
    it('labels quote() results as "estimate"', async () => {
      workerServicesService.findActiveById.mockResolvedValue(workerService());
      const quote = await service.quote('ws-1', {});
      expect(quote.breakdown.mode).toBe('estimate');
    });
  });
});
