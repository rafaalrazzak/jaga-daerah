import '../../test/dom';

import { afterEach, describe, expect, test } from 'bun:test';

import { cleanup, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Leaderboard from './Leaderboard';

const screen = () => within(document.body);

afterEach(() => {
  cleanup();
});

describe('Leaderboard', () => {
  test('switches between absolute totals and a rate per 10,000 residents', async () => {
    const user = userEvent.setup();
    render(<Leaderboard />);

    expect(screen().getByRole('columnheader', { name: /Total Rumah Sakit/ })).toBeTruthy();

    const rateButton = screen().getByRole('button', { name: 'per 10.000 penduduk' });
    await user.click(rateButton);

    expect(rateButton.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen().getByRole('columnheader', { name: /Rumah Sakit per 10.000 Penduduk/ }),
    ).toBeTruthy();
    expect(screen().getByText(/Dukcapil 31 Desember 2024/)).toBeTruthy();

    await user.click(screen().getByRole('button', { name: 'Total' }));
    expect(screen().getByRole('columnheader', { name: /Total Rumah Sakit/ })).toBeTruthy();
  });

  test('keeps the national rank when the table is searched', async () => {
    const user = userEvent.setup();
    render(<Leaderboard />);

    const input = screen().getByRole('textbox', { name: 'Cari nama daerah' });
    await user.type(input, 'asmat');

    const link = await screen().findByRole('link', { name: 'Kabupaten Asmat' });
    const row = link.closest('tr');
    expect(row).not.toBeNull();
    const rank = within(row as HTMLElement)
      .getAllByRole('cell')[0]
      ?.textContent?.trim();
    expect(rank).not.toBe('1');
  });

  test('hides the rate switch on the audit-opinion tab', async () => {
    const user = userEvent.setup();
    render(<Leaderboard />);

    await user.click(screen().getByRole('button', { name: /Opini LKPD BPK RI/ }));

    expect(screen().queryByRole('button', { name: 'per 10.000 penduduk' })).toBeNull();
    expect(screen().getByRole('columnheader', { name: 'Opini BPK RI' })).toBeTruthy();
  });
});
