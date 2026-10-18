import { describe, expect, test } from 'bun:test';

import { classify, countByClass, viewBoxFor } from './map';

describe('classify', () => {
  test('bins by percentage points from the median with exact tenths', () => {
    expect(classify('81.9', '92.0')).toBe('far-below');
    expect(classify('82.0', '92.0')).toBe('below');
    expect(classify('88.9', '92.0')).toBe('below');
    expect(classify('89.0', '92.0')).toBe('near');
    expect(classify('95.0', '92.0')).toBe('near');
    expect(classify('95.1', '92.0')).toBe('above');
    expect(classify('102.0', '92.0')).toBe('above');
    expect(classify('102.1', '92.0')).toBe('far-above');
  });

  test('never invents a class for missing values', () => {
    expect(classify(null, '92.0')).toBe('none');
    expect(classify(undefined, '92.0')).toBe('none');
    expect(classify('90.0', null)).toBe('none');
  });
});

describe('countByClass', () => {
  test('counts only the codes in scope and treats absent rows as no data', () => {
    const items = [
      { code: '32.73', realization_percent: '89.8', median_comparison: 'below' as const },
      { code: '32.04', realization_percent: null, median_comparison: null },
      { code: '11.71', realization_percent: '70.0', median_comparison: 'below' as const },
    ];

    expect(countByClass(items, '92.0', ['32.73', '32.04', '32.99'])).toEqual({
      'far-below': 0,
      below: 0,
      near: 1,
      above: 0,
      'far-above': 0,
      none: 2,
    });
  });
});

describe('viewBoxFor', () => {
  test('pads around the box and keeps a minimum size for tiny regions', () => {
    expect(viewBoxFor([100, 100, 200, 150], 0.1)).toEqual([90, 95, 120, 60]);
    const [, , width, height] = viewBoxFor([10, 10, 11, 11], 0);
    expect([width, height]).toEqual([24, 24]);
  });
});
