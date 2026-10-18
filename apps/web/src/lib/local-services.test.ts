import { describe, expect, test } from 'bun:test';

import { LOCAL_SERVICES } from './local-services';

describe('local services artifact', () => {
  test('counts Kota Bandung hospitals and schools and the Dukcapil population', () => {
    const record = LOCAL_SERVICES.regions['32.73'];
    expect(record?.hospitals).toEqual({ total: 42, umum: 27, ibu_anak: 5, khusus: 10 });
    expect(LOCAL_SERVICES.regions['32.04']?.hospitals?.total).toBe(15);
    expect(record?.schools).toEqual({ sd: 569, smp: 321, sma: 180, smk: 107 });
    expect(record?.population).toEqual({ total: 2591763, male: 1298551, female: 1293212 });
    expect(LOCAL_SERVICES.population.as_of).toBe('2024-12-31');
    expect(LOCAL_SERVICES.population.national_total).toBe(284973643);
    expect(LOCAL_SERVICES.population.note).toContain('bukan hasil Sensus');
    const total = Object.values(LOCAL_SERVICES.regions).reduce((sum, item) => {
      if (item.population === null) throw new Error('missing population');
      expect(item.population.male + item.population.female).toBe(item.population.total);
      return sum + item.population.total;
    }, 0);
    expect(total).toBe(LOCAL_SERVICES.population.national_total);
    expect(LOCAL_SERVICES.hospitals.omitted).toBe(41);
    expect(LOCAL_SERVICES.hospitals.coordinates.url).toContain('list_prop_noncovid');
  });
});
