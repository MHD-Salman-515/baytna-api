import { GeoPoint } from '../cities/schemas/city.schema';

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two [longitude, latitude] GeoJSON points. */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const [lon1, lat1] = a.coordinates;
  const [lon2, lat2] = b.coordinates;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
