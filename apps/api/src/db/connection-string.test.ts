import { describe, expect, test } from 'bun:test';

import { resolveConnectionString } from './connection-string';

describe('resolveConnectionString', () => {
  test('uses a trimmed DATABASE_URL secret', () => {
    expect(
      resolveConnectionString('  postgres://user:secret@db.example/jaga  ', {
        connectionString: 'postgres://local/ignored',
      }),
    ).toBe('postgres://user:secret@db.example/jaga');
  });

  test('falls back to the Hyperdrive binding when the secret is absent', () => {
    expect(resolveConnectionString(undefined, { connectionString: 'postgres://local/jaga' })).toBe(
      'postgres://local/jaga',
    );
  });

  test('rejects a deployment with neither secret nor binding', () => {
    expect(() => resolveConnectionString('  ', undefined)).toThrow(/DATABASE_URL/);
  });
});
