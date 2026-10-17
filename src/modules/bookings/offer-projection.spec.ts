import { OfferProjectionInput, toOfferView } from './offer-projection';

function offer(overrides: Partial<OfferProjectionInput> = {}): OfferProjectionInput {
  return {
    id: 'offer-1',
    bookingId: 'booking-1',
    serviceId: 'service-1',
    serviceName: { ar: 'تنظيف', en: 'Cleaning' },
    estimatedDurationMinutes: 60,
    estimatedPrice: 8000,
    estimatedWorkerEarnings: 6800,
    currency: 'SYP',
    distanceMeters: 1234,
    cityId: 'city-1',
    landmark: 'Next to the blue mosque',
    sentAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  };
}

const ALLOWED_KEYS = new Set([
  'offerId',
  'bookingId',
  'serviceId',
  'serviceName',
  'estimatedDurationMinutes',
  'estimatedPrice',
  'estimatedWorkerEarnings',
  'currency',
  'approximateDistanceMeters',
  'cityId',
  'landmark',
  'sentAt',
]);

describe('toOfferView', () => {
  it('only ever contains the allowlisted keys', () => {
    const view = toOfferView(offer());
    for (const key of Object.keys(view)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  it('never leaks a field tampered onto the input through to the output', () => {
    const tampered = offer() as OfferProjectionInput & {
      customerPhone: string;
      exactAddress: string;
    };
    tampered.customerPhone = '+963900000000';
    tampered.exactAddress = 'Some Street, Building 4, 3rd floor';

    const view = toOfferView(tampered);

    expect(view).not.toHaveProperty('customerPhone');
    expect(view).not.toHaveProperty('exactAddress');
  });

  it('rounds the exact distance to the nearest 500m ("approximate")', () => {
    expect(toOfferView(offer({ distanceMeters: 1234 })).approximateDistanceMeters as number).toBe(
      1000,
    );
    expect(toOfferView(offer({ distanceMeters: 1400 })).approximateDistanceMeters as number).toBe(
      1500,
    );
  });

  it('maps the price/earnings/currency/landmark/city through unchanged', () => {
    const view = toOfferView(offer());
    expect(view.estimatedPrice).toBe(8000);
    expect(view.estimatedWorkerEarnings).toBe(6800);
    expect(view.currency).toBe('SYP');
    expect(view.landmark).toBe('Next to the blue mosque');
    expect(view.cityId).toBe('city-1');
  });
});
