interface HyperdriveBinding {
  connectionString: string;
}

function isHyperdrive(value: unknown): value is HyperdriveBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'connectionString' in value &&
    typeof value.connectionString === 'string' &&
    value.connectionString.trim() !== ''
  );
}

/**
 * Production Workers read the `DATABASE_URL` secret. Local `wrangler dev --env local` has no
 * secret and uses the Hyperdrive binding's local connection string instead.
 */
export function resolveConnectionString(databaseUrl: unknown, hyperdrive: unknown): string {
  if (typeof databaseUrl === 'string' && databaseUrl.trim() !== '') {
    return databaseUrl.trim();
  }

  if (isHyperdrive(hyperdrive)) {
    return hyperdrive.connectionString;
  }

  throw new Error('Database is not configured. Set the DATABASE_URL secret.');
}
