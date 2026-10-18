import { describe, expect, test } from 'bun:test';

import { directDatabaseUrl } from './direct-database-url';

describe('directDatabaseUrl', () => {
  test('removes the Neon pooler hostname marker', () => {
    expect(
      directDatabaseUrl(
        'postgresql://user:secret@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toBe('postgresql://user:secret@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require');
  });

  test('leaves a direct URL unchanged', () => {
    const direct = 'postgresql://user:secret@ep-example.us-east-1.aws.neon.tech/neondb';
    expect(directDatabaseUrl(direct)).toBe(direct);
  });
});
