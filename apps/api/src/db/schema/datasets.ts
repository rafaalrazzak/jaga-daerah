import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const datasetStatus = pgEnum('dataset_status', ['staging', 'active', 'retired', 'failed']);

export const datasetVersions = pgTable(
  'dataset_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    version: text('version').notNull().unique(),
    status: datasetStatus('status').notNull().default('staging'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    etlStartedAt: timestamp('etl_started_at', { withTimezone: true }),
    etlFinishedAt: timestamp('etl_finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one published version may be active; activation swaps it inside one transaction.
    uniqueIndex('dataset_versions_single_active_idx')
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    check(
      'dataset_versions_active_has_published_at',
      sql`${table.status} <> 'active' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      'dataset_versions_etl_window_order',
      sql`${table.etlFinishedAt} IS NULL OR ${table.etlStartedAt} IS NULL OR ${table.etlFinishedAt} >= ${table.etlStartedAt}`,
    ),
  ],
);

export const dataSources = pgTable(
  'data_sources',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    publisher: text('publisher').notNull(),
    title: text('title').notNull(),
    sourceUrl: text('source_url').notNull(),
    period: text('period').notNull(),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('data_sources_checksum_format', sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`),
    check('data_sources_source_url_scheme', sql`${table.sourceUrl} ~ '^https?://'`),
    unique('data_sources_version_checksum_unique').on(table.datasetVersionId, table.checksumSha256),
  ],
);

export type DatasetVersionRow = typeof datasetVersions.$inferSelect;
export type NewDatasetVersionRow = typeof datasetVersions.$inferInsert;
export type DataSourceRow = typeof dataSources.$inferSelect;
export type NewDataSourceRow = typeof dataSources.$inferInsert;
