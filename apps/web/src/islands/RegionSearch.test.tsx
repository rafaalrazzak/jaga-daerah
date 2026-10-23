import '../../test/dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { RegionSummary } from '@jaga-daerah/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient } from '@/lib/query-client';
import { RECENT_REGIONS_KEY } from '@/lib/recent-regions';
import { parseRegionBoundaries } from '@/lib/region-boundaries';

import RegionSearch from './RegionSearch';
import type { RegionSearchProps } from './RegionSearch';

// Testing Library's `screen` binds to document.body at import time, before happy-dom registers;
// resolve it per call instead.
const screen = () => within(document.body);

const JAWA_BARAT = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };
const BANDUNG: RegionSummary[] = [
  {
    code: '32.04',
    name: 'Kabupaten Bandung',
    slug: 'kabupaten-bandung',
    type: 'kabupaten',
    province: JAWA_BARAT,
  },
  { code: '32.73', name: 'Kota Bandung', slug: 'kota-bandung', type: 'kota', province: JAWA_BARAT },
];

type SearchCall = { query: string; signal: AbortSignal | undefined };

function fakeClient(respond: (query: string) => Promise<RegionSummary[]>) {
  const calls: SearchCall[] = [];
  const client: Pick<ApiClient, 'searchRegions'> = {
    searchRegions: (query, options = {}) => {
      calls.push({ query, signal: options.signal });
      return respond(query);
    },
  };
  return { client, calls };
}

function setup(
  respond: (query: string) => Promise<RegionSummary[]>,
  options: Pick<RegionSearchProps, 'locate' | 'loadBoundaries'> = {},
) {
  const { client, calls } = fakeClient(respond);
  const navigate = mock((_href: string) => {});
  const user = userEvent.setup();
  render(
    <RegionSearch
      client={client}
      queryClient={createQueryClient()}
      navigate={navigate}
      debounceMs={20}
      {...options}
    />,
  );
  return { calls, navigate, user, input: screen().getByRole('combobox') };
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  window.localStorage.clear();
});

describe('RegionSearch', () => {
  test('exposes an accessible combobox wired to a listbox', () => {
    const { input } = setup(async () => []);

    expect(input).toHaveProperty('tagName', 'INPUT');
    expect(screen().getByLabelText('Cari kabupaten atau kota')).toBe(input);
    const listboxId = input.getAttribute('aria-controls');
    expect(listboxId).not.toBeNull();
    expect(document.getElementById(listboxId ?? '')?.getAttribute('role')).toBe('listbox');
  });

  test('does not search until at least two characters are typed', async () => {
    const { user, input, calls } = setup(async () => BANDUNG);

    await user.type(input, 'b');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(calls).toHaveLength(0);
  });

  test('debounces keystrokes into one request and lists matching regions', async () => {
    const { user, input, calls } = setup(async () => BANDUNG);

    await user.type(input, 'band');

    expect(await screen().findAllByRole('option')).toHaveLength(2);
    expect(calls.map(({ query }) => query)).toEqual(['band']);
    expect(screen().getByRole('status').textContent).toContain('2 daerah ditemukan');
  });

  test('opens the selected region with the keyboard', async () => {
    const { user, input, navigate } = setup(async () => BANDUNG);

    await user.type(input, 'band');
    await screen().findAllByRole('option');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(navigate).toHaveBeenCalledWith('/daerah/kota-bandung');
    expect(input.getAttribute('aria-activedescendant')).not.toBeNull();
  });

  test('Enter opens the best match when nothing else is highlighted', async () => {
    const { user, input, navigate } = setup(async () => BANDUNG);

    await user.type(input, 'band');
    await screen().findAllByRole('option');
    await user.keyboard('{Enter}');

    expect(navigate).toHaveBeenCalledWith('/daerah/kabupaten-bandung');
  });

  test('Escape clears the query and the results', async () => {
    const { user, input } = setup(async () => BANDUNG);

    await user.type(input, 'band');
    await screen().findAllByRole('option');
    await user.keyboard('{Escape}');

    expect(input).toHaveProperty('value', '');
    expect(screen().queryAllByRole('option')).toHaveLength(0);
  });

  test('explains an empty result', async () => {
    const { user, input } = setup(async () => []);

    await user.type(input, 'zzz');

    await waitFor(() =>
      expect(screen().getByRole('status').textContent).toContain('Tidak ada kabupaten/kota'),
    );
  });

  test('rejects disallowed characters without calling the API', async () => {
    const { user, input, calls } = setup(async () => BANDUNG);

    await user.type(input, 'ban%');

    await waitFor(() =>
      expect(screen().getByRole('status').textContent).toContain('hanya boleh berisi huruf'),
    );
    expect(calls).toHaveLength(0);
  });

  test('shows an error with a working retry', async () => {
    let attempts = 0;
    const { user, input, calls } = setup(async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError('network', 'Tidak dapat terhubung ke server.');
      return BANDUNG;
    });

    await user.type(input, 'band');
    const retry = await screen().findByRole('button', { name: 'Coba lagi' });
    expect(screen().getByRole('status').textContent).toContain('Tidak dapat terhubung');

    await user.click(retry);

    expect(await screen().findAllByRole('option')).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  test('cancels the superseded request when the query changes', async () => {
    const { user, input, calls } = setup(
      (query) =>
        new Promise((resolve) => setTimeout(() => resolve(query === 'band' ? [] : BANDUNG), 200)),
    );

    await user.type(input, 'band');
    await waitFor(() => expect(calls).toHaveLength(1));
    await user.type(input, 'ung');
    await waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.query).toBe('bandung');
  });

  test('reports offline instead of failing', async () => {
    const { user, input, calls } = setup(async () => BANDUNG);
    act(() => onlineManager.setOnline(false));

    await user.type(input, 'band');

    await waitFor(() => expect(screen().getByRole('status').textContent).toContain('offline'));
    expect(calls).toHaveLength(0);
  });

  test('remembers the region opened from search', async () => {
    const { user, input, navigate } = setup(async () => BANDUNG);

    await user.type(input, 'band');
    await screen().findAllByRole('option');
    await user.keyboard('{Enter}');

    expect(navigate).toHaveBeenCalledWith('/daerah/kabupaten-bandung');
    const stored = JSON.parse(window.localStorage.getItem(RECENT_REGIONS_KEY) ?? '[]') as {
      slug?: string;
    }[];
    expect(stored[0]?.slug).toBe('kabupaten-bandung');
  });

  test('shows recently opened regions and can clear them', async () => {
    window.localStorage.setItem(
      RECENT_REGIONS_KEY,
      JSON.stringify([
        {
          code: '32.73',
          name: 'Kota Bandung',
          slug: 'kota-bandung',
          provinceName: 'Jawa Barat',
        },
      ]),
    );
    const { user, navigate } = setup(async () => []);

    const chip = await screen().findByRole('button', { name: /Kota Bandung/ });
    await user.click(chip);
    expect(navigate).toHaveBeenCalledWith('/daerah/kota-bandung');

    await user.click(screen().getByRole('button', { name: 'Hapus riwayat' }));
    expect(screen().queryByText('Terakhir dibuka')).toBeNull();
    expect(window.localStorage.getItem(RECENT_REGIONS_KEY)).toBeNull();
  });

  test('opens the region containing the visitor location', async () => {
    const boundaries = parseRegionBoundaries({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: '32.73' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [106, -7],
                [108, -7],
                [108, -5],
                [106, -5],
                [106, -7],
              ],
            ],
          },
        },
      ],
    });
    const { user, navigate } = setup(async () => [], {
      locate: () => Promise.resolve({ lon: 107, lat: -6 }),
      loadBoundaries: () => Promise.resolve(boundaries),
    });

    await user.click(screen().getByRole('button', { name: 'Gunakan lokasi saya' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/daerah/kota-bandung'));
    expect(await screen().findByText(/Membuka Kota Bandung/)).toBeTruthy();
  });

  test('explains a denied location permission and keeps manual search available', async () => {
    const { user } = setup(async () => [], {
      locate: () => Promise.reject(Object.assign(new Error('denied'), { code: 1 })),
      loadBoundaries: () => Promise.resolve([]),
    });

    await user.click(screen().getByRole('button', { name: 'Gunakan lokasi saya' }));

    expect(await screen().findByText(/Izin lokasi ditolak/)).toBeTruthy();
    expect(screen().getByRole('combobox')).toBeTruthy();
  });
});
