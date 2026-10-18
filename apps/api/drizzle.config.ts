import { defineConfig } from 'drizzle-kit';

// Only `generate` and `check` run through Drizzle Kit; neither needs credentials.
// Migrations are applied by `scripts/migrate.ts`, and `drizzle-kit push` is intentionally unused.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: '../../database/migrations',
  strict: true,
  verbose: true,
});
