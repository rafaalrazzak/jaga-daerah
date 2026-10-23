import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_OPENROUTER_MODEL,
  buildOpenRouterSystemPrompt,
  callOpenRouter,
  getOpenRouterConfig,
} from '@/lib/openrouter';

describe('openrouter module', () => {
  test('uses DEFAULT_OPENROUTER_MODEL (minimax/minimax-m3.1-flash) when unset', () => {
    const config = getOpenRouterConfig();
    expect(config.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(config.model).toContain('minimax/minimax-m3.1-flash');
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

  test('callOpenRouter throws when apiKey is missing', async () => {
    expect(callOpenRouter([{ role: 'user', content: 'Halo' }], { apiKey: '' })).rejects.toThrow(
      'OPENROUTER_API_KEY',
    );
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
