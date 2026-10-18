import { haversineDistanceMeters } from './haversine-distance-meters';

function point(lon: number, lat: number) {
  return { type: 'Point' as const, coordinates: [lon, lat] as [number, number] };
}

describe('haversineDistanceMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistanceMeters(point(36.3, 33.5), point(36.3, 33.5))).toBe(0);
  });

  it('matches a known distance within a small tolerance (Damascus to Aleppo, ~300km)', () => {
    const damascus = point(36.2765, 33.5138);
    const aleppo = point(37.1612, 36.2021);

    const distanceKm = haversineDistanceMeters(damascus, aleppo) / 1000;

    expect(distanceKm).toBeGreaterThan(295);
    expect(distanceKm).toBeLessThan(310);
  });

  it('is symmetric', () => {
    const a = point(36.3, 33.5);
    const b = point(36.31, 33.51);
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});
