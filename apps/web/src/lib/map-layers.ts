import { formatCount } from '@/lib/format';
import type { MapClass } from '@/lib/map';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { REGIONS } from '@/lib/regions';

import { NATURE } from '@/lib/nature';

/** What the choropleth is showing. Electricity is the 2024 province ratio, painted on every kabupaten/kota in that province. */
export type MapLayer = 'realisasi' | 'bencana' | 'rumah-sakit' | 'sekolah' | 'listrik';

export const MAP_LAYERS: readonly { key: MapLayer; label: string }[] = [
  { key: 'realisasi', label: 'Realisasi belanja' },
  { key: 'bencana', label: 'Bencana' },
  { key: 'rumah-sakit', label: 'Rumah sakit' },
  { key: 'sekolah', label: 'Sekolah' },
  { key: 'listrik', label: 'Listrik' },
];

export function disasterSnapshot(code: string): number | null {
  const reg = NATURE.regions[code];
  return reg?.events_by_year?.['2024'] ?? null;
}

export interface HospitalFigures {
  total: number;
  umum: number;
  ibuAnak: number;
  khusus: number;
}

export interface SchoolFigures {
  sd: number;
  smp: number;
  sma: number;
  smk: number;
  total: number;
}

export interface PlaceSnapshot {
  hospitals: HospitalFigures | null;
  schools: SchoolFigures | null;
}

const PLACES = new Map<string, PlaceSnapshot>(
  Object.entries(LOCAL_SERVICES.regions).map(([code, record]) => [
    code,
    {
      hospitals:
        record.hospitals === null
          ? null
          : {
              total: record.hospitals.total,
              umum: record.hospitals.umum,
              ibuAnak: record.hospitals.ibu_anak,
              khusus: record.hospitals.khusus,
            },
      schools:
        record.schools === null
          ? null
          : {
              sd: record.schools.sd,
              smp: record.schools.smp,
              sma: record.schools.sma,
              smk: record.schools.smk,
              total:
                record.schools.sd + record.schools.smp + record.schools.sma + record.schools.smk,
            },
    },
  ]),
);

export function placeSnapshot(code: string): PlaceSnapshot {
  return PLACES.get(code) ?? { hospitals: null, schools: null };
}

export const HOSPITALS_OMITTED = LOCAL_SERVICES.hospitals.omitted;

/** Light → dark quantity bands. The same paint as the budget map, with a different meaning. */
const QUANTITY_CLASSES = ['far-below', 'below', 'near', 'above', 'far-above'] as const;

export const QUANTITY_LABEL: Record<MapClass, string> = {
  'far-below': 'Paling sedikit',
  below: 'Sedikit',
  near: 'Sedang',
  above: 'Banyak',
  'far-above': 'Paling banyak',
  none: 'Belum tersedia',
};

export interface CountBand {
  key: MapClass;
  min: number;
  max: number;
}

export interface CountScale {
  classify: (value: number | null) => MapClass;
  bands: CountBand[];
}

/**
 * Five groups by rank among the values that exist. Missing values stay `none`.
 * Equal numbers share the lower group so the legend ranges do not overlap.
 */
export function countScale(values: readonly (number | null)[]): CountScale {
  const sorted = values
    .filter((value): value is number => value !== null)
    .toSorted((left, right) => left - right);

  const classify = (value: number | null): MapClass => {
    if (value === null || sorted.length === 0) return 'none';
    if (sorted[0] === sorted[sorted.length - 1]) return 'near';
    let rank = 0;
    while (rank < sorted.length) {
      const current = sorted[rank];
      if (current === undefined || current >= value) break;
      rank += 1;
    }
    const band = Math.min(4, Math.floor((rank / (sorted.length - 1)) * 5));
    return QUANTITY_CLASSES[band] ?? 'none';
  };

  const bands = QUANTITY_CLASSES.flatMap((key) => {
    const members = sorted.filter((value) => classify(value) === key);
    const min = members[0];
    const max = members[members.length - 1];
    return min === undefined || max === undefined ? [] : [{ key, min, max }];
  });

  return { classify, bands };
}

/**
 * Rasio elektrifikasi 2024 per provinsi, from ESDM Statistik Ketenagalistrikan Tabel 7.
 * The published percent is stored as printed. Household columns in the PDF are not re-added.
 * Every kabupaten/kota in a province shares that province's ratio.
 */
export const ELECTRIFICATION_YEAR = 2024;
export const ELECTRIFICATION_NATIONAL = '99.83';
export const ELECTRIFICATION_SOURCE = {
  title: 'Statistik Ketenagalistrikan 2024, Tabel 7',
  url: 'https://gatrik.esdm.go.id/assets/uploads/download_index/files/91fa8-buku-statistik-ketenagalistrikan-2024.pdf',
} as const;

export const ELECTRIFICATION: Record<string, string> = {
  '11': '99.99',
  '12': '99.99',
  '13': '99.99',
  '14': '99.99',
  '15': '99.99',
  '16': '99.99',
  '17': '99.99',
  '18': '99.99',
  '19': '99.99',
  '21': '99.99',
  '31': '100.00',
  '32': '99.99',
  '33': '99.99',
  '34': '99.99',
  '35': '99.67',
  '36': '99.99',
  '51': '100.00',
  '52': '99.99',
  '53': '96.35',
  '61': '99.85',
  '62': '98.05',
  '63': '99.99',
  '64': '99.99',
  '65': '99.99',
  '71': '99.99',
  '72': '99.99',
  '73': '99.99',
  '74': '99.78',
  '75': '99.99',
  '76': '99.99',
  '81': '99.08',
  '82': '99.99',
  '91': '99.81',
  '92': '99.99',
  '93': '99.08',
  '94': '94.49',
  '95': '94.02',
  '96': '99.99',
};

export const ELECTRICITY_BANDS: readonly { key: MapClass; label: string; hint: string }[] = [
  { key: 'far-above', label: '100%', hint: 'seluruh rumah tangga tercatat berlistrik' },
  { key: 'above', label: '99,5% atau lebih', hint: 'hampir seluruh rumah tangga' },
  { key: 'near', label: '99%–99,49%', hint: 'masih di bawah 99,5%' },
  { key: 'below', label: '98%–98,99%', hint: 'di bawah 99%' },
  { key: 'far-below', label: 'Di bawah 98%', hint: 'rasio provinsi di bawah 98%' },
];

export function electrificationRatio(regionCode: string): string | null {
  return ELECTRIFICATION[regionCode.slice(0, 2)] ?? null;
}

export function formatRatio(value: string): string {
  return `${value.replace('.', ',')}%`;
}

/** Fixed bands, not rank groups: 99,99% and 94% must not look like neighbours. */
export function electrificationClass(percent: string | null): MapClass {
  if (percent === null) return 'none';
  const value = Number(percent);
  if (!Number.isFinite(value)) return 'none';
  if (value >= 100) return 'far-above';
  if (value >= 99.5) return 'above';
  if (value >= 99) return 'near';
  if (value >= 98) return 'below';
  return 'far-below';
}

/** Layers on a region profile: compare this kabupaten/kota with the rest of its province. */
export type SpreadLayer = 'rumah-sakit' | 'sekolah' | 'listrik';

export const SPREAD_LAYERS: readonly { key: SpreadLayer; label: string }[] = [
  { key: 'rumah-sakit', label: 'Rumah sakit' },
  { key: 'sekolah', label: 'Sekolah' },
  { key: 'listrik', label: 'Listrik' },
];

export interface SpreadReading {
  figure: string;
  sentence: string;
  mapClass: MapClass;
  bands: CountBand[];
}

export function provinceQuantityScale(
  provinceCode: string,
  layer: 'rumah-sakit' | 'sekolah',
): CountScale {
  const values = REGIONS.filter((region) => region.province.code === provinceCode).map((region) => {
    const place = placeSnapshot(region.code);
    return layer === 'rumah-sakit'
      ? (place.hospitals?.total ?? null)
      : (place.schools?.total ?? null);
  });
  return countScale(values);
}

export function spreadFigure(regionCode: string, layer: SpreadLayer): string {
  if (layer === 'listrik') {
    const ratio = electrificationRatio(regionCode);
    return ratio === null ? '—' : formatRatio(ratio);
  }
  const place = placeSnapshot(regionCode);
  if (layer === 'rumah-sakit') {
    return place.hospitals === null ? '—' : formatCount(place.hospitals.total);
  }
  return place.schools === null ? '—' : formatCount(place.schools.total);
}

/** Plain-language reading for one region. Facility colours are ranked inside its province. */
export function spreadReading(regionCode: string, layer: SpreadLayer): SpreadReading {
  const region = REGIONS.find((entry) => entry.code === regionCode);
  const name = region?.name ?? regionCode;
  const province = region?.province.name ?? 'provinsi ini';
  const provinceCode = regionCode.slice(0, 2);

  if (layer === 'listrik') {
    const ratio = electrificationRatio(regionCode);
    return {
      figure: spreadFigure(regionCode, layer),
      mapClass: electrificationClass(ratio),
      bands: [],
      sentence:
        ratio === null
          ? `${name} tidak ada di tabel rasio elektrifikasi.`
          : `Rasio elektrifikasi Provinsi ${province} tahun ${ELECTRIFICATION_YEAR} adalah ${formatRatio(ratio)}. Semua kabupaten dan kota di provinsi ini memakai angka yang sama. Nasional ${formatRatio(ELECTRIFICATION_NATIONAL)}.`,
    };
  }

  const scale = provinceQuantityScale(provinceCode, layer);
  const place = placeSnapshot(regionCode);
  const value =
    layer === 'rumah-sakit' ? (place.hospitals?.total ?? null) : (place.schools?.total ?? null);
  const mapClass = scale.classify(value);
  const group = QUANTITY_LABEL[mapClass].toLowerCase();

  if (layer === 'rumah-sakit') {
    if (place.hospitals === null) {
      return {
        figure: '—',
        mapClass,
        bands: scale.bands,
        sentence: `${name} tidak ada di daftar rumah sakit. Itu bukan nol. Warna lain membandingkan jumlah rumah sakit di ${province}, bukan jumlah per penduduk.`,
      };
    }
    return {
      figure: formatCount(place.hospitals.total),
      mapClass,
      bands: scale.bands,
      sentence: `${name} punya ${formatCount(place.hospitals.total)} rumah sakit: ${formatCount(place.hospitals.umum)} umum, ${formatCount(place.hospitals.ibuAnak)} ibu dan anak, ${formatCount(place.hospitals.khusus)} khusus. Di antara kabupaten dan kota di ${province}, jumlah ini masuk kelompok ${group}. Ini jumlah fasilitas, bukan tempat tidur dan bukan per penduduk.`,
    };
  }

  if (place.schools === null) {
    return {
      figure: '—',
      mapClass,
      bands: scale.bands,
      sentence: `${name} tidak ada di daftar sekolah. Itu bukan nol. Warna lain membandingkan jumlah sekolah di ${province}, bukan jumlah murid.`,
    };
  }
  return {
    figure: formatCount(place.schools.total),
    mapClass,
    bands: scale.bands,
    sentence: `${name} punya ${formatCount(place.schools.total)} sekolah: SD ${formatCount(place.schools.sd)}, SMP ${formatCount(place.schools.smp)}, SMA ${formatCount(place.schools.sma)}, SMK ${formatCount(place.schools.smk)}. Di antara kabupaten dan kota di ${province}, jumlah ini masuk kelompok ${group}. SLB tidak dijumlahkan. Ini jumlah sekolah, bukan murid.`,
  };
}
