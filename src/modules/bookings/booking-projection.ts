import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingType } from '../../common/enums/booking-type.enum';
import { Role } from '../../common/enums/role.enum';

export type BookingViewer = 'CUSTOMER' | 'WORKER' | 'ADMIN';

export interface ProjectionPricingSnapshot {
  pricingType: string;
  hours: number | null;
  roomCount: number | null;
  basePrice: number;
  commissionRate: number;
  commissionAmount: number;
  workerEarnings: number;
  currency: string;
  hourlyRate: number | null;
  minHours: number | null;
}

export interface ProjectionAddress {
  point: { type: 'Point'; coordinates: [number, number] };
  text: string;
  landmark: string;
  floor: string | null;
  notes: string | null;
}

export interface ProjectionCancellation {
  byUserId: string;
  byRole: Role;
  reason: string;
  feeAmount: number;
}

export interface BookingProjectionInput {
  id: string;
  bookingNumber: string;
  customerId: string;
  // Null while an INSTANT booking is SEARCHING.
  workerProfileId: string | null;
  serviceId: string;
  workerServiceId: string | null;
  countryId: string;
  cityId: string;
  type: BookingType;
  status: BookingStatus;
  scheduledFor: Date | null;
  estimatedDurationMinutes: number;
  address: ProjectionAddress;
  // Null while an INSTANT booking is SEARCHING — frozen once a worker is known.
  pricing: ProjectionPricingSnapshot | null;
  finalPricing: ProjectionPricingSnapshot | null;
  // Null for INSTANT (uses instantMatching + the country policy instead).
  responseDeadline: Date | null;
  acceptedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellation: ProjectionCancellation | null;
  rejectionReason: string | null;
  customerNote: string | null;
}

export interface BookingPhones {
  workerPhone: string | null;
  customerPhone: string | null;
}

/**
 * The ONLY path a booking may take to reach a customer, a worker, or an
 * admin — one hand-written object literal per viewer, never a spread of the
 * Mongoose document, same discipline as toPublicWorkerProfile (Phase 3/4).
 *
 * Until a booking has been ACCEPTED at least once (acceptedAt !== null),
 * the customer never sees the worker's phone and the worker never sees
 * more than the customer's city + landmark — not the map pin, the free-text
 * address, the floor, or any notes. Once accepted, both stay revealed even
 * if the booking is later cancelled (they really did already connect).
 * Admin always sees everything, regardless of acceptedAt.
 */
export function toBookingView(
  input: BookingProjectionInput,
  viewer: BookingViewer,
  phones: BookingPhones,
): Record<string, unknown> {
  const revealed = viewer === 'ADMIN' || input.acceptedAt !== null;

  const address =
    viewer === 'WORKER' && !revealed
      ? { landmark: input.address.landmark }
      : {
          point: input.address.point,
          text: input.address.text,
          landmark: input.address.landmark,
          floor: input.address.floor,
          notes: input.address.notes,
        };

  const view: Record<string, unknown> = {
    id: input.id,
    bookingNumber: input.bookingNumber,
    customerId: input.customerId,
    workerProfileId: input.workerProfileId,
    serviceId: input.serviceId,
    workerServiceId: input.workerServiceId,
    countryId: input.countryId,
    cityId: input.cityId,
    type: input.type,
    status: input.status,
    scheduledFor: input.scheduledFor,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    address,
    pricing: input.pricing ? projectPricing(input.pricing, viewer) : null,
    finalPricing: input.finalPricing ? projectPricing(input.finalPricing, viewer) : null,
    responseDeadline: input.responseDeadline,
    acceptedAt: input.acceptedAt,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    cancelledAt: input.cancelledAt,
    cancellation: input.cancellation,
    rejectionReason: input.rejectionReason,
    customerNote: input.customerNote,
  };

  if (viewer === 'CUSTOMER') {
    view.workerPhone = revealed ? phones.workerPhone : null;
  } else if (viewer === 'WORKER') {
    view.customerPhone = revealed ? phones.customerPhone : null;
  } else {
    view.workerPhone = phones.workerPhone;
    view.customerPhone = phones.customerPhone;
  }

  return view;
}

/**
 * CUSTOMER sees the price she pays, never the commission split or the
 * worker's cut. WORKER sees her own earnings, never the customer's gross
 * price or the commission rate applied. ADMIN sees the full breakdown, for
 * support and dispute handling.
 */
function projectPricing(
  snapshot: ProjectionPricingSnapshot,
  viewer: BookingViewer,
): Record<string, unknown> {
  if (viewer === 'ADMIN') {
    return {
      pricingType: snapshot.pricingType,
      hours: snapshot.hours,
      roomCount: snapshot.roomCount,
      basePrice: snapshot.basePrice,
      commissionRate: snapshot.commissionRate,
      commissionAmount: snapshot.commissionAmount,
      workerEarnings: snapshot.workerEarnings,
      currency: snapshot.currency,
      hourlyRate: snapshot.hourlyRate,
      minHours: snapshot.minHours,
    };
  }

  if (viewer === 'WORKER') {
    return {
      pricingType: snapshot.pricingType,
      hours: snapshot.hours,
      roomCount: snapshot.roomCount,
      workerEarnings: snapshot.workerEarnings,
      currency: snapshot.currency,
    };
  }

  return {
    pricingType: snapshot.pricingType,
    hours: snapshot.hours,
    roomCount: snapshot.roomCount,
    basePrice: snapshot.basePrice,
    currency: snapshot.currency,
  };
}
