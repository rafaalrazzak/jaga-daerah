import '../../test/dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { MapRealization } from '@jaga-daerah/contracts';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { MapGeometry } from '@/lib/map';
import { createQueryClient } from '@/lib/query-client';

import InteractiveMap from './InteractiveMap';

const screen = () => within(document.body);

const GEOMETRY: MapGeometry = {
  width: 1200,
  height: 446,
  regions: [
    { code: '32.04', path: 'M0,0L10,0L10,10Z', cx: 5, cy: 5 },
    { code: '32.73', path: 'M20,0L30,0L30,10Z', cx: 25, cy: 5 },
    { code: '11.71', path: 'M40,0L50,0L50,10Z', cx: 45, cy: 5 },
  ],
  provinces: [
    { code: '32', path: 'M0,0L30,0L30,10Z', box: [0, 0, 30, 10] },
    { code: '11', path: 'M40,0L50,0L50,10Z', box: [40, 0, 50, 10] },
  ],
};

function realization(year = 2025): MapRealization {
  return {
    year,
    available_years: [2025, 2024],
    national_median_percent: '92.0',
    items: [
      { code: '32.04', realization_percent: null, median_comparison: null },
      {
        code: '32.73',
        realization_percent: year === 2025 ? '89.8' : '70.0',
        median_comparison: 'below',
      },
      { code: '11.71', realization_percent: '101.9', median_comparison: 'above' },
    ],
  };
}

function setup() {
  const getMapRealization = mock(async ({ year }: { year?: number } = {}) => realization(year));
  const navigate = mock((href: string) => href);
  render(
    <InteractiveMap
      client={{ getMapRealization }}
      loadGeometry={async () => GEOMETRY}
      queryClient={createQueryClient()}
      navigate={navigate}
    />,
  );
  return { getMapRealization, navigate };
}

afterEach(cleanup);

describe('InteractiveMap', () => {
  test('colours regions by distance from the median and keeps missing data distinct', async () => {
    setup();

    const bandung = await waitFor(() => {
      const path = document.querySelector('[data-code="32.73"]');
      if (path === null) throw new Error('map not rendered');
      return path;
    });
    expect(bandung.getAttribute('data-class')).toBe('near');
    expect(document.querySelector('[data-code="32.04"]')?.getAttribute('data-class')).toBe('none');
    expect(document.querySelector('[data-code="11.71"]')?.getAttribute('data-class')).toBe('above');
    expect(screen().getByText(/dibanding median nasional \(92,0%\)/)).toBeDefined();
  });

  test('offers every figure in an accessible table with profile links', async () => {
    setup();
    const user = userEvent.setup();

    await user.click(await screen().findByText(/Lihat sebagai tabel/));
    const table = screen().getByRole('table');
    expect(
      within(table)
        .getByRole('link', { name: /Kota Bandung/ })
        .getAttribute('href'),
    ).toBe('/daerah/kota-bandung');
    expect(within(table).getByText('89,8%')).toBeDefined();

    await user.click(within(table).getByRole('button', { name: /Realisasi/ }));
    const firstRow = within(table).getAllByRole('row')[1];
    expect(firstRow?.textContent).toContain('Kota Banda Aceh');
  });

  test('zooms to a province and narrows the table', async () => {
    setup();
    const user = userEvent.setup();

    await user.selectOptions(await screen().findByLabelText('Wilayah'), '32');

    expect(
      screen().getByText(/Lihat sebagai tabel \(\d+ daerah, Provinsi Jawa Barat\)/),
    ).toBeDefined();
    expect(document.querySelector('[data-code="11.71"]')?.getAttribute('class')).toContain(
      'map-dimmed',
    );
    await user.click(screen().getByRole('button', { name: '← Seluruh Indonesia' }));
    expect(screen().getByText(/seluruh Indonesia\)/)).toBeDefined();
  });

  test('switches year through the API', async () => {
    const { getMapRealization } = setup();
    const user = userEvent.setup();

    await user.selectOptions(await screen().findByLabelText('Tahun'), '2024');

    await waitFor(() =>
      expect(getMapRealization).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2024 })),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-code="32.73"]')?.getAttribute('data-class')).toBe(
        'far-below',
      ),
    );
  });

  test('a mouse click opens the profile; a first tap only shows the figures', async () => {
    const { navigate } = setup();
    const path = await waitFor(() => {
      const element = document.querySelector('[data-code="32.73"]');
      if (element === null) throw new Error('map not rendered');
      return element;
    });

    fireEvent.pointerEnter(path, { pointerType: 'touch' });
    fireEvent.click(path);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen().getByRole('link', { name: 'Buka profil' }).getAttribute('href')).toBe(
      '/daerah/kota-bandung',
    );

    fireEvent.pointerEnter(path, { pointerType: 'mouse' });
    fireEvent.click(path);
    expect(navigate).toHaveBeenCalledWith('/daerah/kota-bandung');
  });

  test('legend buttons highlight one class', async () => {
    setup();
    const user = userEvent.setup();

    const button = await screen().findByRole('button', { name: /^Di atas median/ });
    await user.click(button);

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-code="11.71"]')?.getAttribute('class')).not.toContain(
      'map-dimmed',
    );
    expect(document.querySelector('[data-code="32.73"]')?.getAttribute('class')).toContain(
      'map-dimmed',
    );
  });

  test('switches the choropleth to hospital counts and province electricity ratios', async () => {
    setup();
    const user = userEvent.setup();

    await user.click(await screen().findByRole('radio', { name: 'Rumah sakit' }));
    expect(screen().getByText('Jumlah rumah sakit dibanding kabupaten/kota lain')).toBeDefined();
    expect(document.querySelector('[data-code="32.73"]')?.getAttribute('data-class')).not.toBe(
      'none',
    );

    await user.click(screen().getByRole('radio', { name: 'Listrik' }));
    expect(screen().getByText(/nasional 99,83%/)).toBeDefined();
    expect(document.querySelector('[data-code="32.73"]')?.getAttribute('data-class')).toBe('above');
    expect(screen().queryByLabelText('Tahun')).toBeNull();
  });

  test('zooms with accessible controls and restores the national extent', async () => {
    setup();
    const user = userEvent.setup();
    const map = await screen().findByRole('region', { name: /Peta realisasi belanja/ });

    const initialZoom = map.getAttribute('data-zoom');
    await user.click(screen().getByRole('button', { name: 'Perbesar peta' }));
    await waitFor(() => expect(map.getAttribute('data-zoom')).not.toBe(initialZoom));

    await user.click(screen().getByRole('button', { name: 'Atur ulang pembesaran peta' }));
    await waitFor(() => expect(map.getAttribute('data-zoom')).toBe(initialZoom));
  });
});
