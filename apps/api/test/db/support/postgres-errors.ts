import { expect } from 'bun:test';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_RESTRICT_VIOLATION = '23001';
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
// Thrown when a value is not a member of the target enum type.
export const PG_INVALID_TEXT_REPRESENTATION = '22P02';

// Drizzle wraps driver errors; the PostgreSQL SQLSTATE lives on the original pg error.
export async function expectPostgresError(
  operation: PromiseLike<unknown>,
  sqlState: string | readonly string[],
): Promise<void> {
  const error = await Promise.resolve(operation).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  const allowed = typeof sqlState === 'string' ? [sqlState] : sqlState;

  expect(allowed as readonly unknown[]).toContain(code);
}
