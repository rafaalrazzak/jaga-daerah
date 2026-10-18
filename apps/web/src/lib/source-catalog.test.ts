import { describe, expect, test } from 'bun:test';

import { LOCAL_SERVICES } from './local-services';
import { SANITATION } from './sanitation';
import { SOURCE_CATALOG } from './source-catalog';
import { WELFARE } from './welfare';

function source(id: string) {
  const found = SOURCE_CATALOG.flatMap((group) => group.sources).find((item) => item.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

describe('source catalog', () => {
  test('every link is an https address and every group has a source', () => {
    expect(SOURCE_CATALOG.length).toBeGreaterThan(5);
    for (const group of SOURCE_CATALOG) {
      expect(group.sources.length).toBeGreaterThan(0);
      for (const item of group.sources) {
        expect(item.caveat.length).toBeGreaterThan(10);
        for (const link of item.links) {
          expect(link.href.startsWith('https://')).toBe(true);
        }
      }
    }
  });

  test('hospital, population, and welfare links are the published files', () => {
    expect(source('rumah-sakit').links.map((link) => link.href)).toEqual([
      LOCAL_SERVICES.hospitals.source.url,
      LOCAL_SERVICES.hospitals.coordinates.url,
    ]);
    expect(source('rumah-sakit').caveat).toContain(String(LOCAL_SERVICES.hospitals.omitted));
    expect(source('penduduk-dukcapil').links[0]?.href).toBe(LOCAL_SERVICES.population.source.url);
    expect(source('kemiskinan').links[0]?.href).toBe(WELFARE.poverty.source.url);
    expect(source('pdrb').links[0]?.href).toBe(WELFARE.output.source.url);
    expect(source('ipm').links[0]?.href).toBe(WELFARE.development.source.url);
    expect(source('pdrb').caveat).toContain('bukan gaji');
    expect(source('sanitasi').links[0]?.href).toBe(SANITATION.source.url);
    expect(source('sanitasi').caveat).toContain('bukan sanitasi aman');
  });

  test('finance and opinion links are the ones stored with those files', async () => {
    const checks: Array<[string, string]> = [
      ['apbd-jenis', '../data/expenditure.json'],
      ['apbd-fungsi', '../data/expenditure-functions.json'],
      ['pendapatan', '../data/revenue.json'],
      ['opini', '../data/audit-opinions.json'],
      ['bencana', '../data/nature.json'],
      ['tutupan-lahan', '../data/land-cover.json'],
      ['hujan', '../data/weather.json'],
      ['pilkada', '../data/candidates.json'],
      ['lhkpn', '../data/lhkpn.json'],
      ['luas', '../data/nature.json'],
    ];
    const texts = await Promise.all(
      checks.map(([, path]) => Bun.file(new URL(path, import.meta.url)).text()),
    );
    for (const [index, [id]] of checks.entries()) {
      const href = source(id).links[0]?.href;
      const text = texts[index];
      if (href === undefined || text === undefined) throw new Error(id);
      expect(text).toContain(href);
    }
  });
});
