import '../../test/dom';

import { afterEach, describe, expect, test } from 'bun:test';

import type { NationalBrief } from '@jaga-daerah/contracts';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '@/lib/query-client';

import IndonesiaNow from './IndonesiaNow';

const screen = () => within(document.body);

afterEach(cleanup);

function brief(): NationalBrief {
  return {
    fetched_at: '2026-10-18T03:00:00.000Z',
    earthquakes: {
      status: 'ok',
      items: [
        {
          time: '2026-10-17T15:45:27.000Z',
          latitude: -0.8,
          longitude: 100.9,
          magnitude: 4.6,
          depth_km: 10,
          place: '12 km BaratDaya SIJUNJUNG-SUMBAR',
          felt: 'III Sijunjung',
          tsunami: 'Tidak berpotensi tsunami',
        },
      ],
    },
    warnings: {
      status: 'ok',
      count: 6,
      items: [
        { title: 'Hujan Lebat disertai Petir di Sumatera Barat', province: 'Sumatera Barat' },
      ],
    },
    air: {
      status: 'ok',
      station_count: 2,
      categories: [
        { id: 'baik', count: 0, summary: null },
        { id: 'sedang', count: 1, summary: 'Masih dapat diterima.' },
        { id: 'tidak_sehat', count: 0, summary: null },
        { id: 'sangat_tidak_sehat', count: 0, summary: null },
        { id: 'berbahaya', count: 1, summary: 'Perlu penanganan cepat.' },
      ],
      items: [
        {
          name: 'Palangkaraya Jekan Raya',
          province: 'Kalimantan Tengah',
          value: 1276,
          pollutant: 'PM2.5',
          category: 'berbahaya',
          measured_at: '2026-10-18T15:00:00+07:00',
        },
        {
          name: 'Stasiun Bandung',
          province: 'Jawa Barat',
          value: 80,
          pollutant: 'PM10',
          category: 'sedang',
          measured_at: null,
        },
      ],
    },
    sources: [
      {
        publisher: 'BMKG',
        title: 'Peringatan Dini Cuaca (nowcast)',
        url: 'https://www.bmkg.go.id/alerts/nowcast/id',
      },
      {
        publisher: 'BMKG',
        title: 'Informasi Gempabumi',
        url: 'https://data.bmkg.go.id/gempabumi/',
      },
    ],
  };
}

test('shows the latest quake and how many warnings are still hidden', async () => {
  render(
    <IndonesiaNow
      queryClient={createQueryClient()}
      client={{ getNationalBrief: () => Promise.resolve(brief()) }}
    />,
  );
  expect(await screen().findByText('12 km BaratDaya SIJUNJUNG-SUMBAR')).toBeTruthy();
  expect(screen().getByText('Tidak berpotensi tsunami')).toBeTruthy();
  expect(screen().getByText('BMKG sedang menayangkan 6 peringatan.')).toBeTruthy();
  expect(screen().getByText('Ada 5 peringatan lain di situs BMKG.')).toBeTruthy();
});

test('opens on the worst air category and switches the official advice', async () => {
  render(
    <IndonesiaNow
      queryClient={createQueryClient()}
      client={{ getNationalBrief: () => Promise.resolve(brief()) }}
    />,
  );
  expect((await screen().findAllByText('Palangkaraya Jekan Raya')).length).toBeGreaterThan(0);
  expect(screen().getByText('Hindari seluruh aktivitas di luar ruangan.')).toBeTruthy();
  fireEvent.click(screen().getByRole('button', { name: /Sedang/ }));
  expect(screen().getAllByText('Stasiun Bandung').length).toBeGreaterThan(0);
  expect(screen().getByText('Masih dapat beraktivitas di luar ruangan.')).toBeTruthy();
  expect(screen().queryByText('Palangkaraya Jekan Raya')).toBeNull();
});

test('says when BMKG is not publishing a weather warning', async () => {
  const empty = brief();
  empty.warnings = { status: 'ok', count: 0, items: [] };
  render(
    <IndonesiaNow
      queryClient={createQueryClient()}
      client={{ getNationalBrief: () => Promise.resolve(empty) }}
    />,
  );
  await waitFor(() => {
    expect(screen().getByText('BMKG tidak sedang menayangkan peringatan dini cuaca.')).toBeTruthy();
  });
});

describe('failure', () => {
  test('keeps a way to the official source when the request fails', async () => {
    render(
      <IndonesiaNow
        queryClient={createQueryClient()}
        client={{ getNationalBrief: () => Promise.reject(new Error('down')) }}
      />,
    );
    expect(await screen().findByRole('link', { name: /bmkg\.go\.id/ })).toBeTruthy();
  });
});
