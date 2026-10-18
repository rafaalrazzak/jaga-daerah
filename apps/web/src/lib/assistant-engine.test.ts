import { describe, expect, test } from 'bun:test';

import { queryAssistant } from '@/lib/assistant-engine';

describe('assistant-engine', () => {
  test('returns friendly greeting on empty or halo', () => {
    const res = queryAssistant('halo');
    expect(res.text).toContain('Halo!');
    expect(res.suggestions).toBeDefined();
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  test('answers hospital query for Kota Bandung accurately', () => {
    const res = queryAssistant('Berapa rumah sakit di Kota Bandung?');
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Rumah Sakit');
    expect(res.metrics).toBeDefined();
    expect(res.actions?.[0]?.href).toContain('/daerah/kota-bandung');
  });

  test('answers schools query for Jayapura', () => {
    const res = queryAssistant('Berapa jumlah sekolah di Kota Jayapura?');
    expect(res.text).toContain('Kota Jayapura');
    expect(res.text).toContain('satuan pendidikan');
    expect(res.metrics?.some((m) => m.label.includes('Sekolah Dasar'))).toBe(true);
  });

  test('answers population query for Sorong', () => {
    const res = queryAssistant('Berapa jumlah penduduk di Kabupaten Sorong?');
    expect(res.text).toContain('Kabupaten Sorong');
    expect(res.text).toContain('jiwa');
  });

  test('detects comparison query between Surabaya and Malang', () => {
    const res = queryAssistant('Bandingkan Surabaya vs Malang');
    expect(res.text).toContain('Kota Surabaya');
    expect(res.text).toContain('Kota Malang');
    expect(res.actions?.[0]?.href).toContain(
      '/bandingkan?daerah1=kota-surabaya&daerah2=kota-malang',
    );
  });

  test('answers audit opinion query for Banda Aceh', () => {
    const res = queryAssistant('Bagaimana opini BPK Kota Banda Aceh?');
    expect(res.text).toContain('Kota Banda Aceh');
    expect(res.text).toContain('Badan Pemeriksa Keuangan');
  });

  test('gives helpful fallback for unknown queries', () => {
    const res = queryAssistant('xyzqwerty12345');
    expect(res.text).toContain('belum menemukan');
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });
});
