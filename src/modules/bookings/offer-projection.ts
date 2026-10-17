export interface OfferProjectionInput {
  id: string;
  bookingId: string;
  serviceId: string;
  serviceName: { ar?: string; en?: string } | null;
  estimatedDurationMinutes: number;
  estimatedPrice: number;
  estimatedWorkerEarnings: number;
  currency: string;
  distanceMeters: number;
  cityId: string;
  landmark: string;
  sentAt: Date;
}

/**
 * The ONLY path a pending INSTANT offer may take to reach the worker
 * deciding whether to accept it — a hand-written allowlist, same
 * discipline as toBookingView/toPublicWorkerProfile. She has not accepted
 * yet, so this NEVER includes the customer's phone or exact address (point,
 * free-text street address, floor, notes) — only the city and the landmark,
 * same restriction toBookingView applies pre-acceptance. Distance is
 * rounded to the nearest 500m ("approximate distance", per spec) rather
 * than exposing her precise geo-matched distance.
 */
export function toOfferView(input: OfferProjectionInput): Record<string, unknown> {
  return {
    offerId: input.id,
    bookingId: input.bookingId,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    estimatedPrice: input.estimatedPrice,
    estimatedWorkerEarnings: input.estimatedWorkerEarnings,
    currency: input.currency,
    approximateDistanceMeters: Math.round(input.distanceMeters / 500) * 500,
    cityId: input.cityId,
    landmark: input.landmark,
    sentAt: input.sentAt,
  };
}
