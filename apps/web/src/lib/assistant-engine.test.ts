import { describe, expect, spyOn, test } from 'bun:test';

import { queryAssistant } from '@/lib/assistant-engine';
import type { AssistantContext } from '@/lib/assistant-engine';
import { apiClient } from '@/lib/api-client';
import { REGIONS } from '@/lib/regions';

// Tests for the built-in deterministic engine without network dependencies
const runQuery = (text: string, ctx?: AssistantContext) =>
  queryAssistant(text, { skipOpenRouter: true, ...ctx });

describe('assistant-engine', () => {
  test('returns friendly greeting on empty or halo', async () => {
    const res = await runQuery('halo');
    expect(res.text).toContain('Halo!');
    expect(res.suggestions).toBeDefined();
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  test('answers hospital query for Kota Bandung accurately', async () => {
    const res = await runQuery('Berapa rumah sakit di Kota Bandung?');
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Rumah Sakit');
    expect(res.metrics).toBeDefined();
    expect(res.actions?.[0]?.href).toContain('/daerah/kota-bandung');
  });

  test('answers schools query for Jayapura', async () => {
    const res = await runQuery('Berapa jumlah sekolah di Kota Jayapura?');
    expect(res.text).toContain('Kota Jayapura');
    expect(res.text).toContain('satuan pendidikan');
    expect(res.metrics?.some((m) => m.label.includes('Sekolah Dasar'))).toBe(true);
  });

  test('answers population query for Sorong', async () => {
    const res = await runQuery('Berapa jumlah penduduk di Kabupaten Sorong?');
    expect(res.text).toContain('Kabupaten Sorong');
    expect(res.text).toContain('jiwa');
  });

  test('detects comparison query between Surabaya and Malang', async () => {
    const res = await runQuery('Bandingkan Surabaya vs Malang');
    expect(res.text).toContain('Kota Surabaya');
    expect(res.text).toContain('Kota Malang');
    expect(res.actions?.[0]?.href).toContain(
      '/bandingkan?daerah1=kota-surabaya&daerah2=kota-malang',
    );
  });

  test('answers audit opinion query for Banda Aceh', async () => {
    const res = await runQuery('Bagaimana opini BPK Kota Banda Aceh?');
    expect(res.text).toContain('Kota Banda Aceh');
    expect(res.text).toContain('Badan Pemeriksa Keuangan');
  });

  test('answers evaluation query objectively and non-judgmentally', async () => {
    const res = await runQuery('menurut anda data anggaran di bandung cukup baik atau tidak?');
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
    const res = await runQuery('bagaimana dengan rumah sakitnya?', { lastRegion: bandung });
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Rumah Sakit');
    expect(res.metrics).toBeDefined();
  });

  test('handles follow-up comparison using lastRegion context', async () => {
    const bandung = REGIONS.find((r) => r.slug === 'kota-bandung');
    expect(bandung).toBeDefined();

    // User says "kalau dibanding surabaya gimana?"
    const res = await runQuery('kalau dibanding Surabaya gimana?', { lastRegion: bandung });
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('Kota Surabaya');
    expect(res.actions?.[0]?.href).toContain('daerah1=kota-bandung&daerah2=kota-surabaya');
  });

  test('handles gratitude warmly', async () => {
    const res = await runQuery('makasih ya');
    expect(res.text).toContain('Sama-sama!');
  });

  test('gives helpful fallback for unknown queries', async () => {
    const res = await runQuery('xyzqwerty12345');
    expect(res.text).toContain('belum tercakup');
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  test('answers province disaster query for Jawa Barat accurately with BNPB data', async () => {
    const res = await runQuery('Catatan bencana di Jawa Barat');
    expect(res.text).toContain('Provinsi Jawa Barat');
    expect(res.text).toContain('BNPB');
    expect(res.text).toContain('kejadian bencana');
    expect(res.metrics?.some((m) => m.label.includes('Kejadian Bencana 2024'))).toBe(true);
    expect(res.metrics?.some((m) => m.value.includes('485'))).toBe(true);
  });

  test('answers region disaster query for Kota Bandung with BNPB data', async () => {
    const res = await runQuery('Bencana di Kota Bandung');
    expect(res.text).toContain('Kota Bandung');
    expect(res.text).toContain('BNPB');
    expect(res.metrics?.some((m) => m.label.includes('Kejadian Bencana 2024'))).toBe(true);
  });

  test('strictly rejects coding and HTML generation requests', async () => {
    const res1 = await runQuery('buatkan saya kode HTML');
    expect(res1.text).toContain('tidak dapat membuatkan kode pemrograman');
    expect(res1.text).toContain('Asisten Khusus Data JagaDaerah');

    const res2 = await runQuery('bikin script python untuk scrape data');
    expect(res2.text).toContain('tidak dapat membuatkan kode pemrograman');
  });

  test('does not reject regional identification code queries (kode wilayah/kemendagri)', async () => {
    const res = await runQuery('berapa kode wilayah Kota Bandung?');
    expect(res.text).not.toContain('tidak dapat membuatkan kode pemrograman');
    expect(res.text).toContain('Kota Bandung');
  });

  test('strictly rejects off-topic requests (recipes, poetry, fiction)', async () => {
    const res = await runQuery('resep cara memasak nasi goreng');
    expect(res.text).toContain('di luar konteks data publik daerah');
  });
});

describe('assistant scope gate', () => {
  test('refuses public-figure questions instead of calling the LLM', async () => {
    const llm = spyOn(apiClient, 'askAssistant');
    try {
      const res = await queryAssistant('anda tau Nadiem Makarim Gak?');
      expect(llm).not.toHaveBeenCalled();
      expect(res.text).toContain('hanya bisa menjawab pertanyaan tentang data daerah');
      expect(res.usedOpenRouter).toBeUndefined();
    } finally {
      llm.mockRestore();
    }
  });

  test('still sends regional questions to the LLM proxy', async () => {
    const llm = spyOn(apiClient, 'askAssistant').mockResolvedValue({
      reply: 'Anggaran Kota Bandung tersedia di profil.',
      model: 'test/model',
    });
    const profile = spyOn(apiClient, 'getRegionProfile').mockRejectedValue(new Error('offline'));
    try {
      const res = await queryAssistant('Berapa anggaran Kota Bandung?');
      expect(llm).toHaveBeenCalledTimes(1);
      expect(res.usedOpenRouter).toBe(true);
      expect(res.modelUsed).toBe('test/model');
    } finally {
      llm.mockRestore();
      profile.mockRestore();
    }
  });
});
