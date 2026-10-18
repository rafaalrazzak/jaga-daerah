import { describe, expect, test } from 'bun:test';

import { LiveConditionsResponseSchema } from '@jaga-daerah/contracts';

import type { RegionLivePoint } from '#api/repositories/live-points';
import {
  FIRMS_AREA_URL,
  FIRMS_REGIONAL_URL,
  FORECAST_URL,
  ISPU_URL,
  QUAKE_URLS,
  WARNING_INDEX_URL,
  forecastPlace,
  getLiveConditions,
  getNationalBrief,
} from '#api/services/live-conditions';
import type { FetchUpstream } from '#api/services/live-conditions';
import {
  matchKecamatan,
  parseCapWarning,
  parseAirStations,
  parseEarthquakes,
  parseForecast,
  parseHotspots,
  parseWarningIndex,
  provinceKey,
} from '#api/services/live-parsers';

const NOW = new Date('2026-10-18T03:00:00Z');

const POINT: RegionLivePoint = {
  slug: 'kabupaten-sijunjung',
  code: '13.03',
  name: 'Kabupaten Sijunjung',
  province_code: '13',
  province_name: 'Sumatera Barat',
  adm4: '13.03.01.2001',
  desa: 'Sungai Lansek',
  kecamatan: 'Kamang Baru',
  lat: -0.69,
  lon: 100.95,
  bbox: [100.5, -1.1, 101.4, -0.3],
  kecamatan_list: [
    { code: '13.03.04', name: 'IV Nagari', adm4: '13.03.04.2001', desa: 'Muaro Bodi' },
    { code: '13.03.01', name: 'Kamang Baru', adm4: '13.03.01.2001', desa: 'Sungai Lansek' },
    { code: '13.03.02', name: 'Sijunjung', adm4: '13.03.02.2001', desa: 'Muaro' },
    { code: '13.03.03', name: 'Sumpur Kudus', adm4: '13.03.03.2001', desa: 'Sumpur Kudus' },
    { code: '13.03.05', name: 'Tanjung Gadang', adm4: '13.03.05.2001', desa: 'Tanjung Gadang' },
  ],
};

const DEFAULT_PLACE = {
  code: '13.03.01',
  name: 'Kamang Baru',
  adm4: '13.03.01.2001',
  desa: 'Sungai Lansek',
};

const FORECAST = {
  lokasi: { adm4: '13.03.01.2001' },
  data: [
    {
      lokasi: { timezone: '+0700' },
      cuaca: [
        [
          {
            datetime: '2026-10-17T20:00:00Z',
            t: 22,
            hu: 95,
            weather: 3,
            weather_desc: 'Berawan',
            ws: 2,
            wd: 'E',
            tcc: 90,
            tp: 0,
            analysis_date: '2026-10-18T00:00:00',
          },
          {
            datetime: '2026-10-18T02:00:00Z',
            t: 31,
            hu: 60,
            weather: 1,
            weather_desc: 'Cerah',
            ws: 3.4,
            wd: 'NW',
            tcc: 18,
            tp: 0,
            analysis_date: '2026-10-18T00:00:00',
          },
        ],
        [
          { datetime: '2026-10-18T05:00:00Z', t: 'not a number', weather: 61, weather_desc: 'X' },
          {
            datetime: '2026-10-18T08:00:00Z',
            t: 27,
            hu: 88,
            weather: 95,
            weather_desc: 'Hujan Petir',
            ws: 12.8,
            wd: 'SE',
            tcc: 100,
            tp: 14.2,
          },
        ],
      ],
    },
  ],
};

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Hujan Lebat disertai Petir di Sumatera Barat</title>
<link>https://www.bmkg.go.id/alerts/nowcast/id/CSB20261018001_alert.xml</link></item>
<item><title>Hujan Sedang di Kalimantan Barat</title>
<link>https://www.bmkg.go.id/alerts/nowcast/id/CKB20261018001_alert.xml</link></item>
<item><title>Spoofed</title><link>https://evil.example/alert.xml</link></item>
</channel></rss>`;

const CAP_URL = 'https://www.bmkg.go.id/alerts/nowcast/id/CSB20261018001_alert.xml';

function cap(overrides: { expires?: string; area?: string; description?: string } = {}) {
  return `<?xml version="1.0" ?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>2.49.0.1.360.0.2026.10.18.01.13.001</identifier>
  <info>
    <event>Hujan Lebat dan Petir</event>
    <severity>Moderate</severity>
    <effective>2026-10-18T08:00:00+07:00</effective>
    <expires>${overrides.expires ?? '2026-10-18T12:00:00+07:00'}</expires>
    <headline>Hujan Lebat disertai Petir di Sumatera Barat</headline>
    <description>${
      overrides.description ??
      'Hujan lebat disertai petir akan terjadi di sebagian wilayah Sumatera Barat, khususnya di KAMANG BARU, PANGKALAN KOTO BARU, SUMPUR KUDUS, TANJUNG GADANG.\n Masyarakat dihimbau &amp; waspada.'
    }</description>
    <web>https://nowcasting.bmkg.go.id/infografis/CSB/2026/10/18/infografis.jpg</web>
    <area><areaDesc>${overrides.area ?? 'Sumatera Barat'}</areaDesc><polygon>-0.1,100 -0.2,100.1</polygon></area>
  </info>
</alert>`;
}

const QUAKES = {
  Infogempa: {
    gempa: [
      {
        DateTime: '2026-10-17T15:45:27+00:00',
        Coordinates: '-0.80,100.90',
        Magnitude: '4.6',
        Kedalaman: '10 km',
        Wilayah: '12 km BaratDaya SIJUNJUNG-SUMBAR',
        Dirasakan: 'III Sijunjung',
      },
      {
        DateTime: '2026-10-17T12:00:00+00:00',
        Coordinates: '-8.73,106.47',
        Magnitude: '5.7',
        Kedalaman: '10 km',
        Wilayah: 'Selatan Jawa',
      },
      {
        DateTime: '2026-10-10T00:00:00+00:00',
        Coordinates: '-0.70,100.95',
        Magnitude: '5.0',
        Kedalaman: '5 km',
        Wilayah: 'Terlalu lama',
      },
    ],
  },
};
const AUTOGEMPA = {
  Infogempa: {
    gempa: {
      DateTime: '2026-10-17T15:45:27+00:00',
      Coordinates: '-0.80,100.90',
      Magnitude: '4.6',
      Kedalaman: '10 km',
      Wilayah: '12 km BaratDaya SIJUNJUNG-SUMBAR',
      Potensi: 'Tidak berpotensi tsunami',
    },
  },
};

const FIRMS_CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version
-0.71,100.96,330.1,0.4,0.4,2026-10-18,0612,N,VIIRS,h,2.0NRT
-0.72,100.97,310.0,0.4,0.4,2026-10-17,1840,N,VIIRS,n,2.0NRT
-0.73,100.98,300.0,0.4,0.4,2026-10-16,0100,N,VIIRS,l,2.0NRT
bad,row`;

function upstream(routes: Record<string, string | null>): FetchUpstream {
  return async (url) => {
    const body = routes[url];
    if (body === undefined) throw new Error(`unexpected ${url}`);
    return body === null ? new Response('down', { status: 503 }) : new Response(body);
  };
}

function allFeeds(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    [`${FORECAST_URL}?adm4=13.03.01.2001`]: JSON.stringify(FORECAST),
    [WARNING_INDEX_URL]: RSS,
    [CAP_URL]: cap(),
    [QUAKE_URLS[0]]: JSON.stringify(AUTOGEMPA),
    [QUAKE_URLS[1]]: JSON.stringify(QUAKES),
    [QUAKE_URLS[2]]: JSON.stringify(QUAKES),
    [`${FIRMS_AREA_URL}/key/VIIRS_SNPP_NRT/100.5,-1.1,101.4,-0.3/1`]: FIRMS_CSV,
    ...overrides,
  };
}

describe('live parsers', () => {
  test('forecast keeps the current and later valid slots in time order', () => {
    const parsed = parseForecast(FORECAST, NOW, 8);
    expect(parsed?.timeZone).toBe('Asia/Jakarta');
    expect(parsed?.analysisAt).toBe('2026-10-18T00:00:00');
    expect(parsed?.slots.map((slot) => slot.weather)).toEqual(['Cerah', 'Hujan Petir']);
    expect(parsed?.slots[1]?.rain_mm).toBe(14.2);
  });

  test('forecast without slots is null', () => {
    expect(parseForecast({ data: [] }, NOW, 8)).toBeNull();
    expect(parseForecast('nonsense', NOW, 8)).toBeNull();
  });

  test('warning index only accepts BMKG CAP links', () => {
    expect(parseWarningIndex(RSS).map((item) => item.link)).toEqual([
      CAP_URL,
      'https://www.bmkg.go.id/alerts/nowcast/id/CKB20261018001_alert.xml',
    ]);
  });

  test('CAP warning decodes entities and keeps only a BMKG infographic', () => {
    const warning = parseCapWarning(cap());
    expect(warning?.severity).toBe('Moderate');
    expect(warning?.description).toContain('dihimbau & waspada');
    expect(warning?.infographicUrl).toStartWith('https://nowcasting.bmkg.go.id/');
    expect(parseCapWarning('<alert><identifier>x</identifier></alert>')).toBeNull();
  });

  test('kecamatan match is exact on normalized names, never fuzzy', () => {
    const names = POINT.kecamatan_list.map((entry) => entry.name);
    expect(
      matchKecamatan(
        'khususnya di KAMANG BARU, SUMPUR KUDUS, IV NAGARI dan TANJUNG GADANG.',
        names,
      ),
    ).toEqual(['IV Nagari', 'Kamang Baru', 'Sumpur Kudus', 'Tanjung Gadang']);
    expect(matchKecamatan('khususnya di SIJUNJUNG BARAT.', names)).toEqual([]);
  });

  test('province names compare across BMKG and Kemendagri spellings', () => {
    expect(provinceKey('DKI Jakarta')).toBe(provinceKey('Daerah Khusus Ibukota Jakarta'));
    expect(provinceKey('DI Yogyakarta')).toBe(provinceKey('Daerah Istimewa Yogyakarta'));
    expect(provinceKey('Bangka Belitung')).toBe(provinceKey('Kepulauan Bangka Belitung'));
    expect(provinceKey('Papua')).not.toBe(provinceKey('Papua Barat'));
  });

  test('earthquakes parse both single and list shapes, with coordinates', () => {
    expect(parseEarthquakes(AUTOGEMPA)).toHaveLength(1);
    expect(parseEarthquakes(QUAKES)[0]).toMatchObject({ depth_km: 10, latitude: -0.8 });
    expect(parseEarthquakes({})).toEqual([]);
  });

  test('hotspots map FIRMS confidence letters and MODIS percentages, skipping bad rows', () => {
    expect(parseHotspots(FIRMS_CSV).map((spot) => spot.confidence)).toEqual([
      'high',
      'nominal',
      'low',
    ]);
    expect(parseHotspots(FIRMS_CSV)[0]?.detected_at).toBe('2026-10-18T06:12:00.000Z');
    expect(parseHotspots('a,b\n1,2')).toEqual([]);
  });
});

describe('forecastPlace', () => {
  test('defaults to the region reference and accepts only the region kecamatan', () => {
    expect(forecastPlace(POINT, undefined)).toEqual(DEFAULT_PLACE);
    expect(forecastPlace(POINT, '13.03.05')?.desa).toBe('Tanjung Gadang');
    expect(forecastPlace(POINT, '32.01.01')).toBeUndefined();
  });
});

describe('getLiveConditions', () => {
  test('assembles every feed and matches the region', async () => {
    const live = await getLiveConditions(POINT, DEFAULT_PLACE, {
      fetchUpstream: upstream(allFeeds()),
      firmsMapKey: 'key',
      now: NOW,
    });

    expect(live.forecast.location).toMatchObject({
      desa: 'Sungai Lansek',
      kecamatan_code: '13.03.01',
    });
    expect(live.kecamatan_options).toHaveLength(5);
    expect(live.warnings.items[0]?.kecamatan).toEqual([
      'Kamang Baru',
      'Sumpur Kudus',
      'Tanjung Gadang',
    ]);
    // Near quake kept once with felt + tsunami merged; far and old ones dropped.
    expect(live.earthquakes.items).toHaveLength(1);
    expect(live.earthquakes.items[0]).toMatchObject({
      felt: 'III Sijunjung',
      tsunami: 'Tidak berpotensi tsunami',
    });
    expect(live.earthquakes.items[0]?.distance_km).toBeLessThan(20);
    expect(live.hotspots).toMatchObject({
      status: 'ok',
      instrument: 'VIIRS S-NPP',
      count: 2,
      high_confidence_count: 1,
    });

    const envelope = {
      data: live,
      meta: { request_id: 'r', dataset_version: null, generated_at: NOW.toISOString() },
    };
    expect(LiveConditionsResponseSchema.safeParse(envelope).success).toBe(true);
  });

  test('without a FIRMS key, reads the regional MODIS file and keeps detections in the box', async () => {
    const modis = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version
-0.70,100.90,320.1,1,1,2026-10-18,0130,T,85,6.1NRT
-0.71,100.91,310.1,1,1,2026-10-18,0130,T,40,6.1NRT
3.50,98.60,330.0,1,1,2026-10-18,0130,T,90,6.1NRT`;
    const live = await getLiveConditions(POINT, DEFAULT_PLACE, {
      fetchUpstream: upstream(allFeeds({ [FIRMS_REGIONAL_URL]: modis })),
      firmsMapKey: undefined,
      now: NOW,
    });
    expect(live.hotspots).toMatchObject({
      status: 'ok',
      instrument: 'MODIS',
      count: 2,
      high_confidence_count: 1,
    });
  });

  test.each([
    ['expired', cap({ expires: '2026-10-18T09:59:00+07:00' })],
    ['other-province', cap({ area: 'Sumatera Utara' })],
    ['unmatched', cap({ description: 'khususnya di PADANG UTARA.' })],
  ])('%s warnings are not shown', async (_case, document) => {
    const live = await getLiveConditions(POINT, DEFAULT_PLACE, {
      fetchUpstream: upstream(allFeeds({ [CAP_URL]: document })),
      firmsMapKey: 'key',
      now: NOW,
    });
    expect(live.warnings).toEqual({ status: 'ok', items: [] });
  });

  test('each feed fails on its own and never reports "none" when it could not read', async () => {
    const live = await getLiveConditions(POINT, DEFAULT_PLACE, {
      fetchUpstream: upstream(
        allFeeds({
          [`${FORECAST_URL}?adm4=13.03.01.2001`]: null,
          [CAP_URL]: null,
          [QUAKE_URLS[0]]: null,
          [QUAKE_URLS[1]]: null,
          [QUAKE_URLS[2]]: null,
          [FIRMS_REGIONAL_URL]: null,
        }),
      ),
      firmsMapKey: undefined,
      now: NOW,
    });

    expect(live.forecast.status).toBe('unavailable');
    expect(live.warnings.status).toBe('unavailable');
    expect(live.earthquakes.status).toBe('unavailable');
    expect(live.hotspots).toMatchObject({ status: 'unavailable', instrument: 'MODIS' });
  });
});

describe('getNationalBrief', () => {
  test('lists the newest quakes in the country and the warning headlines', async () => {
    const brief = await getNationalBrief({
      fetchUpstream: upstream({
        [QUAKE_URLS[0]]: JSON.stringify(AUTOGEMPA),
        [QUAKE_URLS[1]]: JSON.stringify({
          Infogempa: {
            gempa: [
              ...QUAKES.Infogempa.gempa,
              {
                DateTime: '2026-10-18T06:00:00+00:00',
                Coordinates: '-1.00,100.00',
                Magnitude: '3.1',
                Kedalaman: '10 km',
                Wilayah: 'Masa depan',
              },
            ],
          },
        }),
        [QUAKE_URLS[2]]: null,
        [WARNING_INDEX_URL]: RSS,
      }),
      firmsMapKey: undefined,
      now: NOW,
    });

    expect(brief.earthquakes.items.map((item) => item.place)).toEqual([
      '12 km BaratDaya SIJUNJUNG-SUMBAR',
      'Selatan Jawa',
      'Terlalu lama',
    ]);
    expect(brief.earthquakes.items[0]).toMatchObject({
      magnitude: 4.6,
      felt: 'III Sijunjung',
      tsunami: 'Tidak berpotensi tsunami',
    });
    expect(brief.air.status).toBe('not_configured');
    expect(brief.warnings).toMatchObject({
      status: 'ok',
      count: 2,
      items: [
        { title: 'Hujan Lebat disertai Petir di Sumatera Barat', province: 'Sumatera Barat' },
        { title: 'Hujan Sedang di Kalimantan Barat', province: 'Kalimantan Barat' },
      ],
    });
  });

  test('a failed quake feed does not hide warnings that arrived', async () => {
    const brief = await getNationalBrief({
      fetchUpstream: upstream({
        [QUAKE_URLS[0]]: null,
        [QUAKE_URLS[1]]: null,
        [QUAKE_URLS[2]]: null,
        [WARNING_INDEX_URL]: RSS,
      }),
      firmsMapKey: undefined,
      now: NOW,
    });
    expect(brief.earthquakes).toEqual({ status: 'unavailable', items: [] });
    expect(brief.warnings.status).toBe('ok');
    expect(brief.warnings.count).toBe(2);
  });

  test('reads ISPU stations and drops addresses when a token is set', async () => {
    let authorization = '';
    const brief = await getNationalBrief({
      fetchUpstream: async (url, ttl, headers) => {
        if (url === ISPU_URL) {
          authorization = headers?.authorization ?? '';
          return new Response(
            JSON.stringify({
              rows: [
                {
                  nama: 'Palangkaraya Jekan Raya',
                  val: '1276',
                  param: 'PM<sub>2.5</sub>',
                  cat: 'BERBAHAYA',
                  provinsi: 'Kalimantan Tengah',
                  waktu: '2026-10-18 15:00:00',
                  time_z: 'WIB',
                  alamat: 'Kantor Kecamatan Jekan Raya',
                  lat: '-2.2',
                  lon: '113.9',
                  stasiun_show: '1',
                  kategori: { keterangan: 'Perlu penanganan cepat.' },
                },
                {
                  nama: 'Tersembunyi',
                  val: '10',
                  param: 'PM10',
                  cat: 'BAIK',
                  stasiun_show: '0',
                },
                {
                  nama: 'Tanpa label',
                  val: '40',
                  param: 'SO2',
                  provinsi: 'Jawa Barat',
                  stasiun_show: '1',
                },
              ],
            }),
          );
        }
        return upstream({
          [QUAKE_URLS[0]]: null,
          [QUAKE_URLS[1]]: null,
          [QUAKE_URLS[2]]: null,
          [WARNING_INDEX_URL]: RSS,
        })(url, ttl);
      },
      firmsMapKey: undefined,
      ispuApiToken: 'token',
      now: NOW,
    });

    expect(authorization).toBe('Bearer token');
    expect(brief.air.station_count).toBe(2);
    expect(brief.air.items[0]).toMatchObject({
      name: 'Palangkaraya Jekan Raya',
      pollutant: 'PM2.5',
      category: 'berbahaya',
      value: 1276,
      measured_at: '2026-10-18T15:00:00+07:00',
    });
    expect(brief.air.items[1]).toMatchObject({ name: 'Tanpa label', category: 'baik' });
    expect(JSON.stringify(brief.air)).not.toContain('Kantor');
    expect(brief.air.categories.find((item) => item.id === 'berbahaya')?.summary).toBe(
      'Perlu penanganan cepat.',
    );
    expect(parseAirStations({ rows: 'bukan-daftar' })).toBeNull();
  });
});
