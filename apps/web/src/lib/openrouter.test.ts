import { describe, expect, test } from 'bun:test';

import { DEFAULT_OPENROUTER_MODEL, buildOpenRouterSystemPrompt } from '@/lib/openrouter';

describe('openrouter module', () => {
  test('keeps the expected default model id', () => {
    expect(DEFAULT_OPENROUTER_MODEL).toContain('openrouter/free');
  });

  test('builds system prompt with regional data and neutrality guidelines', () => {
    const prompt = buildOpenRouterSystemPrompt(
      'DATA DAERAH: Kota Bandung\nPenduduk: 2.500.000 jiwa',
    );
    expect(prompt).toContain('Asisten Cerdas JagaDaerah');
    expect(prompt).toContain('PRINSIP NETRALITAS');
    expect(prompt).toContain('Kota Bandung');
    expect(prompt).toContain('DATA TERVERIFIKASI');
  });

  test('cleanAssistantOutput removes Chinese characters and generic markdown blocks', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    const input = 'Banjir di wilayah — 約area hulu.\n\n```\ncatatan internal\n```\n\nData valid.';
    const cleaned = cleanAssistantOutput(input);
    expect(cleaned).not.toContain('約');
    expect(cleaned).not.toContain('catatan internal');
    expect(cleaned).toContain('Banjir di wilayah — area hulu.');
    expect(cleaned).toContain('Data valid.');
  });

  test('cleanAssistantOutput intercepts code and HTML generation and returns strict refusal', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    const htmlInput =
      'Berikut halaman HTML:\n```html\n<!DOCTYPE html><html><body>Test</body></html>\n```\nSimpan sebagai `bandung.html`.';
    const cleanedHtml = cleanAssistantOutput(htmlInput);
    expect(cleanedHtml).toContain('tidak dapat membuatkan kode pemrograman');
    expect(cleanedHtml).not.toContain('<!DOCTYPE html>');

    const pythonInput = '```python\nprint("test")\n```';
    const cleanedPy = cleanAssistantOutput(pythonInput);
    expect(cleanedPy).toContain('tidak dapat membuatkan kode pemrograman');
  });

  test('cleanAssistantOutput repairs stray braces, escapes, underscores, and English nouns', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    const input =
      'Dari sisi}_\\(realisasi penggunaan anggaran dan.opini audit, kinerja anggaran Malang tergolong baik. Namun, penilaian mengenai kecukupan dan dampaknya masih memerlukan data pendapatan daerah, kebutuhan Population, serta hasil pembangunan dan pelayanan publik.';
    const cleaned = cleanAssistantOutput(input);
    expect(cleaned).not.toContain('{');
    expect(cleaned).not.toContain('}');
    expect(cleaned).not.toContain('\\(');
    expect(cleaned).not.toContain('_');
    expect(cleaned).not.toContain('Population');
    expect(cleaned).toContain('kebutuhan penduduk');
    expect(cleaned).toContain('dan. Opini audit');
    expect(cleaned.startsWith('Dari sisi')).toBe(true);
  });

  test('cleanAssistantOutput capitalizes sentences and fixes spacing before punctuation', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    expect(cleanAssistantOutput('halo! ini data . selanjutnya, gunakan data ini.')).toBe(
      'Halo! Ini data. Selanjutnya, gunakan data ini.',
    );
  });

  test('cleanAssistantOutput leaves normal rupiah decimals alone', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    expect(cleanAssistantOutput('Anggaran Rp10.000.000,50 terealisasi 82,4%.')).toBe(
      'Anggaran Rp10.000.000,50 terealisasi 82,4%.',
    );
  });

  test('cleanAssistantOutput strips MiniMax thinking tags and internal deliberation leaks', async () => {
    const { cleanAssistantOutput } = await import('@/lib/openrouter');
    const input =
      '<mm:think>Let us think in English. Avoid English.</mm:think>Halo! Selamat datang di JagaDaerah. During 2024, banjir tercatat according to BNPB. Silakan conveyed? No. "Silakan sampaikan data." Good.';
    const cleaned = cleanAssistantOutput(input);
    expect(cleaned).not.toContain('<mm:think>');
    expect(cleaned).not.toContain('Let us think');
    expect(cleaned).not.toContain('During 2024');
    expect(cleaned).toContain('Sepanjang tahun 2024');
    expect(cleaned).not.toContain('according to');
    expect(cleaned).toContain('berdasarkan data BNPB');
    expect(cleaned).not.toContain('Silakan conveyed?');
    expect(cleaned).not.toContain('Good.');
    expect(cleaned).toContain('Silakan sampaikan data.');
  });
});
