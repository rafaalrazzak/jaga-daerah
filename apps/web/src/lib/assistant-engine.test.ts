import { describe, expect, test } from 'bun:test';

import { queryAssistant } from '@/lib/assistant-engine';
import { REGIONS } from '@/lib/regions';

describe('assistant-engine', () => {
  test('returns friendly greeting on empty or halo', async () => {
    const res = await queryAssistant('halo');
    expect(res.text).toContain('Halo!');
    expect(res.suggestions).toBeDefined();
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  test('answers hospital query for Kota Bandung accurately', async () => {
    const res = await queryAssistant('Berapa rumah sakit di Kota Bandung?');
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Rumah Sakit');
    expect(res.metrics).toBeDefined();
    expect(res.actions?.[0]?.href).toContain('/daerah/kota-bandung');
  });

  test('answers schools query for Jayapura', async () => {
    const res = await queryAssistant('Berapa jumlah sekolah di Kota Jayapura?');
    expect(res.text).toContain('Kota Jayapura');
    expect(res.text).toContain('satuan pendidikan');
    expect(res.metrics?.some((m) => m.label.includes('Sekolah Dasar'))).toBe(true);
  });

  test('answers population query for Sorong', async () => {
    const res = await queryAssistant('Berapa jumlah penduduk di Kabupaten Sorong?');
    expect(res.text).toContain('Kabupaten Sorong');
    expect(res.text).toContain('jiwa');
  });

  test('detects comparison query between Surabaya and Malang', async () => {
    const res = await queryAssistant('Bandingkan Surabaya vs Malang');
    expect(res.text).toContain('Kota Surabaya');
    expect(res.text).toContain('Kota Malang');
    expect(res.actions?.[0]?.href).toContain(
      '/bandingkan?daerah1=kota-surabaya&daerah2=kota-malang',
    );
  });

  test('answers audit opinion query for Banda Aceh', async () => {
    const res = await queryAssistant('Bagaimana opini BPK Kota Banda Aceh?');
    expect(res.text).toContain('Kota Banda Aceh');
    expect(res.text).toContain('Badan Pemeriksa Keuangan');
  });

  test('answers evaluation query objectively and non-judgmentally', async () => {
    const res = await queryAssistant(
      'menurut anda data anggaran di bandung cukup baik atau tidak?',
    );
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('tidak menilai kinerja pemerintah secara subjektif');
    expect(res.text).toContain('Realisasi Belanja');
    expect(res.metrics?.some((m) => m.label.includes('Realisasi Belanja'))).toBe(true);
    expect(res.metrics?.some((m) => m.label.includes('Belanja Modal'))).toBe(true);
    expect(res.metrics?.some((m) => m.label.includes('Opini BPK'))).toBe(true);
  });

  test('resolves follow-up query using lastRegion context', async () => {
    const bandung = REGIONS.find((r) => r.slug === 'kota-bandung');
    expect(bandung).toBeDefined();

    // User asks without mentioning Bandung:
    const res = await queryAssistant('bagaimana dengan rumah sakitnya?', { lastRegion: bandung });
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Rumah Sakit');
    expect(res.metrics).toBeDefined();
  });

  test('handles follow-up comparison using lastRegion context', async () => {
    const bandung = REGIONS.find((r) => r.slug === 'kota-bandung');
    expect(bandung).toBeDefined();

    // User says "kalau dibanding surabaya gimana?"
    const res = await queryAssistant('kalau dibanding Surabaya gimana?', { lastRegion: bandung });
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Kota Surabaya');
    expect(res.actions?.[0]?.href).toContain('daerah1=kota-bandung&daerah2=kota-surabaya');
  });

  test('handles gratitude warmly', async () => {
    const res = await queryAssistant('makasih ya');
    expect(res.text).toContain('Sama-sama!');
  });

  test('gives helpful fallback for unknown queries', async () => {
    const res = await queryAssistant('xyzqwerty12345');
    expect(res.text).toContain('belum tercakup');
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });
});
