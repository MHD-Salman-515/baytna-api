export interface CitySeed {
  countryCode: string;
  name: { ar: string; en: string };
  center: { type: 'Point'; coordinates: [number, number] }; // [longitude, latitude]
}

export const citiesSeedData: CitySeed[] = [
  // Syria
  {
    countryCode: 'SY',
    name: { ar: 'دمشق', en: 'Damascus' },
    center: { type: 'Point', coordinates: [36.2765, 33.5138] },
  },
  {
    countryCode: 'SY',
    name: { ar: 'حلب', en: 'Aleppo' },
    center: { type: 'Point', coordinates: [37.1343, 36.2021] },
  },
  {
    countryCode: 'SY',
    name: { ar: 'حمص', en: 'Homs' },
    center: { type: 'Point', coordinates: [36.7137, 34.7324] },
  },
  {
    countryCode: 'SY',
    name: { ar: 'اللاذقية', en: 'Latakia' },
    center: { type: 'Point', coordinates: [35.7913, 35.5317] },
  },
  // Iraq
  {
    countryCode: 'IQ',
    name: { ar: 'بغداد', en: 'Baghdad' },
    center: { type: 'Point', coordinates: [44.3661, 33.3152] },
  },
  {
    countryCode: 'IQ',
    name: { ar: 'البصرة', en: 'Basra' },
    center: { type: 'Point', coordinates: [47.7835, 30.5085] },
  },
  {
    countryCode: 'IQ',
    name: { ar: 'أربيل', en: 'Erbil' },
    center: { type: 'Point', coordinates: [44.0093, 36.1911] },
  },
  {
    countryCode: 'IQ',
    name: { ar: 'الموصل', en: 'Mosul' },
    center: { type: 'Point', coordinates: [43.1189, 36.3489] },
  },
];
