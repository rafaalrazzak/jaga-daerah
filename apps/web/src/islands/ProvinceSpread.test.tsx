import '../../test/dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { MapGeometry } from '@/lib/map';
import { createQueryClient } from '@/lib/query-client';

import ProvinceSpread from './ProvinceSpread';

const screen = () => within(document.body);

const GEOMETRY: MapGeometry = {
  width: 1200,
  height: 446,
  regions: [
    { code: '32.04', path: 'M0,0L10,0L10,10Z', cx: 5, cy: 5 },
    { code: '32.73', path: 'M20,0L30,0L30,10Z', cx: 25, cy: 5 },
  ],
  provinces: [{ code: '32', path: 'M0,0L30,0L30,10Z', box: [0, 0, 30, 10] }],
};

function setup() {
  const navigate = mock(() => undefined);
  const queryClient = createQueryClient();
  render(
    <ProvinceSpread
      regionCode="32.73"
      regionName="Kota Bandung"
      provinceName="Jawa Barat"
      loadGeometry={() => Promise.resolve(GEOMETRY)}
      queryClient={queryClient}
      navigate={navigate}
    />,
  );
  return { navigate };
}

describe('ProvinceSpread', () => {
  afterEach(() => {
    cleanup();
  });

  test('shows Kota Bandung hospital counts inside the province', async () => {
    setup();

    expect((await screen().findAllByText('42')).length).toBeGreaterThan(0);
    expect(screen().getAllByText(/masuk kelompok/).length).toBeGreaterThan(0);
    expect(document.querySelector('path[data-code="32.73"]')?.getAttribute('data-class')).not.toBe(
      'none',
    );
  });

  test('paints the province electricity ratio on every kabupaten and kota', async () => {
    setup();
    const user = userEvent.setup();

    await user.click(await screen().findByRole('radio', { name: 'Listrik' }));

    expect(screen().getAllByText('99,99%').length).toBeGreaterThan(0);
    expect(screen().getAllByText(/angka yang sama/).length).toBeGreaterThan(0);
    expect(document.querySelector('path[data-code="32.73"]')?.getAttribute('data-class')).toBe(
      'above',
    );
    expect(document.querySelector('path[data-code="32.04"]')?.getAttribute('data-class')).toBe(
      'above',
    );
  });

  test('a click on another region opens its profile', async () => {
    const { navigate } = setup();

    const path = await waitFor(() => {
      const element = document.querySelector('path[data-code="32.04"]');
      if (element === null) throw new Error('map not rendered');
      return element;
    });
    fireEvent.click(path);
    expect(navigate).toHaveBeenCalledWith('/daerah/kabupaten-bandung');
  });
});
