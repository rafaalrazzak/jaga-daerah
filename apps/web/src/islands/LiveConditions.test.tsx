import '../../test/dom';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import type { LiveConditions as LiveData } from '@jaga-daerah/contracts';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ApiClient } from '@/lib/api-client';
import { createQueryClient } from '@/lib/query-client';

import LiveConditions from './LiveConditions';

const screen = () => within(document.body);

function live(overrides: Partial<LiveData> = {}): LiveData {
  return {
    region: { code: '13.03', name: 'Kabupaten Sijunjung', slug: 'kabupaten-sijunjung' },
    kecamatan_options: [
      { code: '13.03.01', name: 'Kamang Baru' },
      { code: '13.03.05', name: 'Tanjung Gadang' },
    ],
    fetched_at: '2026-10-18T02:00:00.000Z',
    forecast: {
      status: 'ok',
      location: {
        adm4: '13.03.01.2001',
        desa: 'Sungai Lansek',
        kecamatan: 'Kamang Baru',
        kecamatan_code: '13.03.01',
      },
      time_zone: 'Asia/Jakarta',
      analysis_at: '2026-10-18T00:00:00',
      slots: [
        {
          time: '2026-10-18T02:00:00.000Z',
          temperature_c: 31,
          humidity_percent: 60,
          weather_code: 95,
          weather: 'Hujan Petir',
          wind_speed_kmh: 12.8,
          wind_from: 'SE',
          cloud_percent: 100,
          rain_mm: 14.2,
        },
        {
          time: '2026-10-18T05:00:00.000Z',
          temperature_c: 27,
          humidity_percent: 88,
          weather_code: 61,
          weather: 'Hujan Ringan',
          wind_speed_kmh: 4,
          wind_from: 'S',
          cloud_percent: 90,
          rain_mm: 1,
        },
      ],
    },
    warnings: {
      status: 'ok',
      items: [
        {
          id: 'cap-1',
          event: 'Hujan Lebat dan Petir',
          headline: 'Hujan Lebat disertai Petir di Sumatera Barat',
          severity: 'Moderate',
          effective: '2026-10-18T08:00:00+07:00',
          expires: '2026-10-18T10:00:00+07:00',
          kecamatan: ['Kamang Baru', 'Tanjung Gadang'],
          description: 'Hujan lebat disertai petir akan terjadi.',
          infographic_url: null,
          source_url: 'https://www.bmkg.go.id/alerts/nowcast/id/CSB20261018001_alert.xml',
        },
      ],
    },
    earthquakes: { status: 'ok', radius_km: 200, window_hours: 72, items: [] },
    hotspots: {
      status: 'ok',
      instrument: 'MODIS',
      window_hours: 24,
      count: 0,
      high_confidence_count: 0,
      latest_at: null,
      items: [],
    },
    sources: [{ publisher: 'BMKG', title: 'Prakiraan Cuaca', url: 'https://data.bmkg.go.id/' }],
    ...overrides,
  };
}

function setup(respond: (kecamatan: string | undefined) => Promise<LiveData>) {
  const calls: (string | undefined)[] = [];
  const client: Pick<ApiClient, 'getLiveConditions'> = {
    getLiveConditions: (_slug, options = {}) => {
      calls.push(options.kecamatan);
      return respond(options.kecamatan);
    },
  };
  render(
    <LiveConditions
      slug="kabupaten-sijunjung"
      regionName="Kabupaten Sijunjung"
      client={client}
      queryClient={createQueryClient()}
    />,
  );
  return { calls, user: userEvent.setup() };
}

// The kecamatan map loads a static geometry file; tests have no server, so it fails fast instead.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/daerah/kabupaten-sijunjung');
});

describe('LiveConditions', () => {
  test('puts an active BMKG warning first, with the matched kecamatan and validity', async () => {
    setup(async () => live());

    const alerts = await screen().findByRole('list', { name: '1 peringatan aktif' });
    expect(within(alerts).getByText('Hujan Lebat disertai Petir di Sumatera Barat')).toBeDefined();
    expect(within(alerts).getByText(/Kamang Baru, Tanjung Gadang/)).toBeDefined();
    expect(within(alerts).getByText(/Peringatan dini BMKG · Waspada/)).toBeDefined();
    expect(screen().getAllByText('31°').length).toBeGreaterThan(0);
    expect(screen().getAllByText('Hujan Petir').length).toBeGreaterThan(0);
  });

  test('never calls a quiet feed "aman", and says when the warning feed failed', async () => {
    setup(async () => live({ warnings: { status: 'unavailable', items: [] } }));

    expect(await screen().findByText(/Peringatan dini BMKG tidak dapat dimuat/)).toBeDefined();
    expect(screen().getByText(/Ini bukan jaminan aman/)).toBeDefined();
  });

  test('picking a kecamatan re-reads the forecast and records it in the URL', async () => {
    const { calls, user } = setup(async (kecamatan) =>
      live(
        kecamatan === '13.03.05'
          ? {
              forecast: {
                ...live().forecast,
                location: {
                  adm4: '13.03.05.2001',
                  desa: 'Tanjung Gadang',
                  kecamatan: 'Tanjung Gadang',
                  kecamatan_code: '13.03.05',
                },
              },
            }
          : {},
      ),
    );

    await user.selectOptions(await screen().findByLabelText('Kecamatan'), '13.03.05');

    await waitFor(() => expect(calls).toContain('13.03.05'));
    expect(window.location.search).toBe('?kecamatan=13.03.05');
    expect(await screen().findByText(/Kel\.\/Desa Tanjung Gadang/)).toBeDefined();
  });

  test('a hotspot detection is raised as an alert with its caveat', async () => {
    setup(async () =>
      live({
        warnings: { status: 'ok', items: [] },
        hotspots: {
          status: 'ok',
          instrument: 'MODIS',
          window_hours: 24,
          count: 3,
          high_confidence_count: 1,
          latest_at: '2026-10-18T01:30:00.000Z',
          items: [],
        },
      }),
    );

    expect(await screen().findByText(/3 titik panas terdeteksi/)).toBeDefined();
    expect(screen().getAllByText(/belum tentu kebakaran/).length).toBeGreaterThan(0);
  });
});
