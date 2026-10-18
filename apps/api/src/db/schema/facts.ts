import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { dataSources, datasetVersions } from './datasets';
import { provinces, regions } from './reference';

// BNPB "Kompilasi Data Kejadian dan Dampak Bencana" categories, in source column order.
export const disasterType = pgEnum('disaster_type', [
  'banjir',
  'cuaca_ekstrem',
  'erupsi_gunung_api',
  'gelombang_pasang_abrasi',
  'gempabumi',
  'kebakaran_hutan_lahan',
  'kekeringan',
  'tanah_longsor',
  'tsunami',
]);

export const etlRunStatus = pgEnum('etl_run_status', ['running', 'succeeded', 'failed']);

const YEAR_RANGE = sql`BETWEEN 2000 AND 2100`;

// Rupiah keeps two decimals because DJPK publishes fractional realisations; values travel as
// decimal strings (mode: 'string') so nothing is coerced to a JavaScript number.
const rupiah = (name: string) => numeric(name, { precision: 20, scale: 2, mode: 'string' });

export const budgetFacts = pgTable(
  'budget_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    // NULL = the source did not report a value; 0 = the source reported zero.
    budgetAmount: rupiah('budget_amount'),
    realizationAmount: rupiah('realization_amount'),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  },
  (table) => [
    unique('budget_facts_region_year_version_unique').on(
      table.regionId,
      table.year,
      table.datasetVersionId,
    ),
    check('budget_facts_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'budget_facts_budget_non_negative',
      sql`${table.budgetAmount} IS NULL OR ${table.budgetAmount} >= 0`,
    ),
    check(
      'budget_facts_realization_non_negative',
      sql`${table.realizationAmount} IS NULL OR ${table.realizationAmount} >= 0`,
    ),
    index('budget_facts_version_year_idx').on(table.datasetVersionId, table.year),
  ],
);

// APBD expenditure by "jenis belanja": the standard classification DJPK publishes per pemda
// beneath the Belanja Daerah aggregate. The ten values form a disjoint partition of Belanja
// Daerah, so their sum must reconcile with the published total (enforced by the ETL gate).
// DJPK's "Belanja Lainnya" subtotal is deliberately not a value here: it is an aggregate of the
// last seven, and storing it would double-count in any sum.
export const expenditureType = pgEnum('expenditure_type', [
  'belanja_pegawai',
  'belanja_barang_dan_jasa',
  'belanja_modal',
  'belanja_bunga',
  'belanja_subsidi',
  'belanja_hibah',
  'belanja_bantuan_sosial',
  'belanja_bagi_hasil',
  'belanja_bantuan_keuangan',
  'belanja_tidak_terduga',
]);

export const expenditureBreakdownFacts = pgTable(
  'expenditure_breakdown_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    expenditureType: expenditureType('expenditure_type').notNull(),
    // NULL = the source did not report a value; 0 = the source reported zero.
    budgetAmount: rupiah('budget_amount'),
    realizationAmount: rupiah('realization_amount'),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  },
  (table) => [
    unique('expenditure_breakdown_facts_region_year_type_version_unique').on(
      table.regionId,
      table.year,
      table.expenditureType,
      table.datasetVersionId,
    ),
    check('expenditure_breakdown_facts_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'expenditure_breakdown_facts_amounts_non_negative',
      sql`(${table.budgetAmount} IS NULL OR ${table.budgetAmount} >= 0)
        AND (${table.realizationAmount} IS NULL OR ${table.realizationAmount} >= 0)`,
    ),
    index('expenditure_breakdown_facts_version_region_year_idx').on(
      table.datasetVersionId,
      table.regionId,
      table.year,
    ),
  ],
);

// DJPK "Realisasi Belanja Daerah menurut fungsi". Nine functions. Tagging lines for kesehatan and
// pendidikan are folded into those functions before insert. budget_amount stays NULL when the
// workbook is realisation-only; that is not a reported zero.
export const expenditureFunction = pgEnum('expenditure_function', [
  'pelayanan_umum',
  'ketertiban_dan_keamanan',
  'ekonomi',
  'perlindungan_lingkungan_hidup',
  'perumahan_dan_fasilitas_umum',
  'kesehatan',
  'pariwisata',
  'pendidikan',
  'perlindungan_sosial',
]);

export const expenditureFunctionFacts = pgTable(
  'expenditure_function_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    functionType: expenditureFunction('function_type').notNull(),
    budgetAmount: rupiah('budget_amount'),
    realizationAmount: rupiah('realization_amount'),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  },
  (table) => [
    unique('expenditure_function_facts_region_year_type_version_unique').on(
      table.regionId,
      table.year,
      table.functionType,
      table.datasetVersionId,
    ),
    check('expenditure_function_facts_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'expenditure_function_facts_amounts_non_negative',
      sql`(${table.budgetAmount} IS NULL OR ${table.budgetAmount} >= 0)
        AND (${table.realizationAmount} IS NULL OR ${table.realizationAmount} >= 0)`,
    ),
    index('expenditure_function_facts_version_region_year_idx').on(
      table.datasetVersionId,
      table.regionId,
      table.year,
    ),
  ],
);

// DJPK TKDD "Dana Bagi Hasil" lines grouped by resource (Dana Bagi Hasil SDA + DBH Perkebunan
// Sawit). This is revenue-sharing a region receives, not a measure of its natural resources.
export const naturalResourceType = pgEnum('natural_resource_type', [
  'minyak_bumi',
  'gas_bumi',
  'minerba',
  'kehutanan',
  'perikanan',
  'panas_bumi',
  'perkebunan_sawit',
]);

export const naturalResourceRevenueFacts = pgTable(
  'natural_resource_revenue_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    resourceType: naturalResourceType('resource_type').notNull(),
    // DJPK prints these in miliar with two decimals (Rp10 juta steps); NULL = blank cell.
    budgetAmount: rupiah('budget_amount'),
    realizationAmount: rupiah('realization_amount'),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  },
  (table) => [
    unique('natural_resource_facts_region_year_type_version_unique').on(
      table.regionId,
      table.year,
      table.resourceType,
      table.datasetVersionId,
    ),
    check('natural_resource_facts_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'natural_resource_facts_amounts_non_negative',
      sql`(${table.budgetAmount} IS NULL OR ${table.budgetAmount} >= 0)
        AND (${table.realizationAmount} IS NULL OR ${table.realizationAmount} >= 0)`,
    ),
    index('natural_resource_facts_version_region_year_idx').on(
      table.datasetVersionId,
      table.regionId,
      table.year,
    ),
  ],
);

export const disasterFacts = pgTable(
  'disaster_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    provinceId: integer('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    disasterType: disasterType('disaster_type').notNull(),
    // NULL = not reported by the source; 0 = explicitly reported zero.
    eventCount: integer('event_count'),
    deaths: integer('deaths'),
    missing: integer('missing'),
    affected: integer('affected'),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  },
  (table) => [
    unique('disaster_facts_province_year_type_version_unique').on(
      table.provinceId,
      table.year,
      table.disasterType,
      table.datasetVersionId,
    ),
    check('disaster_facts_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'disaster_facts_counts_non_negative',
      sql`(${table.eventCount} IS NULL OR ${table.eventCount} >= 0)
        AND (${table.deaths} IS NULL OR ${table.deaths} >= 0)
        AND (${table.missing} IS NULL OR ${table.missing} >= 0)
        AND (${table.affected} IS NULL OR ${table.affected} >= 0)`,
    ),
    index('disaster_facts_version_year_idx').on(table.datasetVersionId, table.year),
  ],
);

export const etlRuns = pgTable(
  'etl_runs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    pipeline: text('pipeline').notNull(),
    status: etlRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    rowsRead: integer('rows_read').notNull().default(0),
    rowsLoaded: integer('rows_loaded').notNull().default(0),
    rowsRejected: integer('rows_rejected').notNull().default(0),
    report: jsonb('report').notNull().default({}),
  },
  (table) => [
    check(
      'etl_runs_row_counts_non_negative',
      sql`${table.rowsRead} >= 0 AND ${table.rowsLoaded} >= 0 AND ${table.rowsRejected} >= 0`,
    ),
    check(
      'etl_runs_finished_when_done',
      sql`${table.status} = 'running' OR ${table.finishedAt} IS NOT NULL`,
    ),
    index('etl_runs_dataset_version_id_idx').on(table.datasetVersionId),
  ],
);

export type BudgetFactRow = typeof budgetFacts.$inferSelect;
export type ExpenditureBreakdownFactRow = typeof expenditureBreakdownFacts.$inferSelect;
export type ExpenditureFunctionFactRow = typeof expenditureFunctionFacts.$inferSelect;
export type DisasterFactRow = typeof disasterFacts.$inferSelect;
export type EtlRunRow = typeof etlRuns.$inferSelect;

// Reviewed caveats attached to published facts (e.g. BNPB rows that disagree with BNPB's own
// national total). Shown next to the affected figures; never used to alter values.
export const dataNotes = pgTable(
  'data_notes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    datasetVersionId: integer('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    year: smallint('year').notNull(),
    disasterType: disasterType('disaster_type'),
    metric: text('metric').notNull(),
    note: text('note').notNull(),
  },
  (table) => [
    check('data_notes_year_range', sql`${table.year} ${YEAR_RANGE}`),
    check(
      'data_notes_metric_known',
      sql`${table.metric} IN ('event_count', 'deaths', 'missing', 'affected', 'budget_amount', 'realization_amount')`,
    ),
    index('data_notes_version_year_idx').on(table.datasetVersionId, table.year),
  ],
);

export type DataNoteRow = typeof dataNotes.$inferSelect;
