import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingType } from '../../common/enums/booking-type.enum';
import { PricingType } from '../../common/enums/pricing-type.enum';
import { Role } from '../../common/enums/role.enum';
import { BookingProjectionInput, toBookingView } from './booking-projection';

function booking(overrides: Partial<BookingProjectionInput> = {}): BookingProjectionInput {
  return {
    id: 'booking-1',
    bookingNumber: 'BK-ABC123',
    customerId: 'customer-1',
    workerProfileId: 'worker-1',
    serviceId: 'service-1',
    workerServiceId: 'worker-service-1',
    countryId: 'country-1',
    cityId: 'city-1',
    type: BookingType.SCHEDULED,
    status: BookingStatus.PENDING_WORKER,
    scheduledFor: new Date('2026-11-10T10:00:00.000Z'),
    estimatedDurationMinutes: 120,
    address: {
      point: { type: 'Point', coordinates: [36.3, 33.5] },
      text: 'Some Street, Building 4',
      landmark: 'Next to the blue mosque',
      floor: '3rd floor',
      notes: 'Ring twice',
    },
    pricing: {
      pricingType: PricingType.HOURLY,
      hours: 2,
      roomCount: null,
      basePrice: 6000,
      commissionRate: 1500,
      commissionAmount: 900,
      workerEarnings: 5100,
      currency: 'SYP',
      hourlyRate: 3000,
      minHours: 2,
    },
    finalPricing: null,
    responseDeadline: new Date('2026-11-09T22:00:00.000Z'),
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellation: null,
    rejectionReason: null,
    customerNote: 'Please bring extra towels',
    ...overrides,
  };
}

const phones = { workerPhone: '+963900000001', customerPhone: '+963900000002' };

describe('toBookingView', () => {
  describe('before acceptance (acceptedAt === null)', () => {
    it('hides the worker phone from the customer', () => {
      const view = toBookingView(booking(), 'CUSTOMER', phones);
      expect(view.workerPhone).toBeNull();
    });

    it('hides the exact address from the worker, keeping only the landmark', () => {
      const view = toBookingView(booking(), 'WORKER', phones) as {
        address: Record<string, unknown>;
      };
      expect(view.address).toEqual({ landmark: 'Next to the blue mosque' });
      expect(view.address.point).toBeUndefined();
      expect(view.address.text).toBeUndefined();
      expect(view.address.floor).toBeUndefined();
      expect(view.address.notes).toBeUndefined();
    });

    it('hides the customer phone from the worker', () => {
      const view = toBookingView(booking(), 'WORKER', phones);
      expect(view.customerPhone).toBeNull();
    });

    it("the customer still sees her own full address (restriction is about the worker's view, not hers)", () => {
      const view = toBookingView(booking(), 'CUSTOMER', phones) as {
        address: Record<string, unknown>;
      };
      expect(view.address).toEqual(booking().address);
    });
  });

  describe('after acceptance (acceptedAt set)', () => {
    const accepted = booking({ acceptedAt: new Date('2026-11-05T00:00:00.000Z') });

    it('reveals the worker phone to the customer', () => {
      const view = toBookingView(accepted, 'CUSTOMER', phones);
      expect(view.workerPhone).toBe(phones.workerPhone);
    });

    it('reveals the full address to the worker', () => {
      const view = toBookingView(accepted, 'WORKER', phones) as {
        address: Record<string, unknown>;
      };
      expect(view.address).toEqual(accepted.address);
    });

    it('reveals the customer phone to the worker', () => {
      const view = toBookingView(accepted, 'WORKER', phones);
      expect(view.customerPhone).toBe(phones.customerPhone);
    });

    it('stays revealed even if the booking is later cancelled', () => {
      const cancelledAfterAccept = booking({
        acceptedAt: new Date('2026-11-05T00:00:00.000Z'),
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date('2026-11-06T00:00:00.000Z'),
      });
      const view = toBookingView(cancelledAfterAccept, 'WORKER', phones);
      expect(view.customerPhone).toBe(phones.customerPhone);
    });
  });

  describe('admin viewer', () => {
    it('always sees both phones and the full address, regardless of acceptedAt', () => {
      const view = toBookingView(booking(), 'ADMIN', phones) as {
        address: Record<string, unknown>;
        workerPhone: unknown;
        customerPhone: unknown;
      };
      expect(view.workerPhone).toBe(phones.workerPhone);
      expect(view.customerPhone).toBe(phones.customerPhone);
      expect(view.address).toEqual(booking().address);
    });
  });

  describe('pricing projection', () => {
    it('customer sees basePrice, never commission or worker earnings', () => {
      const view = toBookingView(booking(), 'CUSTOMER', phones) as {
        pricing: Record<string, unknown>;
      };
      expect(view.pricing.basePrice).toBe(6000);
      expect(view.pricing.commissionAmount).toBeUndefined();
      expect(view.pricing.commissionRate).toBeUndefined();
      expect(view.pricing.workerEarnings).toBeUndefined();
    });

    it('worker sees her own earnings, never basePrice or the commission rate', () => {
      const view = toBookingView(booking(), 'WORKER', phones) as {
        pricing: Record<string, unknown>;
      };
      expect(view.pricing.workerEarnings).toBe(5100);
      expect(view.pricing.basePrice).toBeUndefined();
      expect(view.pricing.commissionAmount).toBeUndefined();
      expect(view.pricing.commissionRate).toBeUndefined();
    });

    it('admin sees the full breakdown', () => {
      const view = toBookingView(booking(), 'ADMIN', phones) as {
        pricing: Record<string, unknown>;
      };
      expect(view.pricing).toMatchObject({
        basePrice: 6000,
        commissionRate: 1500,
        commissionAmount: 900,
        workerEarnings: 5100,
      });
    });

    it('finalPricing is null until the booking carries one, for every viewer', () => {
      expect(
        (toBookingView(booking(), 'CUSTOMER', phones) as { finalPricing: unknown }).finalPricing,
      ).toBeNull();
      expect(
        (toBookingView(booking(), 'WORKER', phones) as { finalPricing: unknown }).finalPricing,
      ).toBeNull();
    });

    it('finalPricing, once present, is projected the same way as pricing', () => {
      const withFinal = booking({
        finalPricing: {
          pricingType: PricingType.HOURLY,
          hours: 3,
          roomCount: null,
          basePrice: 9000,
          commissionRate: 1500,
          commissionAmount: 1350,
          workerEarnings: 7650,
          currency: 'SYP',
          hourlyRate: 3000,
          minHours: 2,
        },
      });
      const customerView = toBookingView(withFinal, 'CUSTOMER', phones) as {
        finalPricing: Record<string, unknown>;
      };
      expect(customerView.finalPricing.basePrice).toBe(9000);
      expect(customerView.finalPricing.workerEarnings).toBeUndefined();
    });
  });

  it('never leaks a fake extra field on the input through to the output (allowlist, not a spread)', () => {
    const tampered = booking() as BookingProjectionInput & { somethingSensitive: string };
    tampered.somethingSensitive = 'leaked!';
    const view = toBookingView(tampered, 'CUSTOMER', phones);
    expect(view).not.toHaveProperty('somethingSensitive');
  });

  it('carries non-sensitive fields (rejectionReason, cancellation, customerNote) through for every viewer', () => {
    const rejected = booking({
      status: BookingStatus.REJECTED,
      rejectionReason: 'Too far from my service area',
    });
    const view = toBookingView(rejected, 'WORKER', phones);
    expect(view.rejectionReason).toBe('Too far from my service area');

    const cancelled = booking({
      status: BookingStatus.CANCELLED,
      cancellation: {
        byUserId: 'customer-1',
        byRole: Role.CUSTOMER,
        reason: 'Change of plans',
        feeAmount: 1200,
      },
    });
    const cancelledView = toBookingView(cancelled, 'CUSTOMER', phones);
    expect(cancelledView.cancellation).toEqual({
      byUserId: 'customer-1',
      byRole: Role.CUSTOMER,
      reason: 'Change of plans',
      feeAmount: 1200,
    });
  });
});
