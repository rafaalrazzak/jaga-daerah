import { describe, expect, test } from 'bun:test';

import { clampView, clientToUser, zoomAt } from '@/lib/map-viewport';
import type { ViewBox } from '@/lib/map-viewport';

const HOME: ViewBox = [0, 0, 200, 80];

describe('zoomAt', () => {
  test('keeps the anchor on the same map point', () => {
    const next = zoomAt([0, 0, 100, 50], 2, 25, 10);
    expect(next[0]).toBeCloseTo(12.5);
    expect(next[1]).toBeCloseTo(5);
    expect(next[2]).toBeCloseTo(50);
    expect(next[3]).toBeCloseTo(25);
    const before = (25 - 0) / 100;
    const after = (25 - next[0]) / next[2];
    expect(after).toBeCloseTo(before);
  });
});

describe('clampView', () => {
  test('holds the centre inside the home extent', () => {
    const next = clampView([-500, -200, 40, 16], HOME);
    expect(next[0] + next[2] / 2).toBeGreaterThanOrEqual(HOME[0]);
    expect(next[0] + next[2] / 2).toBeLessThanOrEqual(HOME[0] + HOME[2]);
    expect(next[1] + next[3] / 2).toBeGreaterThanOrEqual(HOME[1]);
    expect(next[2]).toBeCloseTo(40);
  });

  test('refuses to zoom out past the margin', () => {
    const next = clampView([-100, -40, 800, 320], HOME);
    expect(HOME[2] / next[2]).toBeCloseTo(0.75);
  });

  test('refuses to zoom in past the detail limit', () => {
    const next = clampView([10, 4, 2, 0.8], HOME);
    expect(HOME[2] / next[2]).toBeCloseTo(12);
  });
});

describe('clientToUser', () => {
  test('maps the middle of a matching box to the middle of the view', () => {
    const point = clientToUser({ left: 0, top: 0, width: 400, height: 160 }, HOME, 200, 80);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(40);
  });

  test('ignores side bars when the element is wider than the map', () => {
    const point = clientToUser({ left: 0, top: 0, width: 800, height: 160 }, HOME, 400, 80);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(40);
  });
});
