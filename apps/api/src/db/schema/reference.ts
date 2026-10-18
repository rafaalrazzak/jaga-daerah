import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const regionType = pgEnum('region_type', ['kabupaten', 'kota']);

// Kemendagri codes are strings so leading zeroes and the dotted format survive every boundary.
export const provinces = pgTable(
  'provinces',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    code: varchar('code', { length: 2 }).notNull().unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('provinces_code_format', sql`${table.code} ~ '^[0-9]{2}$'`),
    check('provinces_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const regions = pgTable(
  'regions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    provinceId: integer('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    code: varchar('code', { length: 5 }).notNull().unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    type: regionType('type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // Lowercased name without the "Kabupaten"/"Kota" (and DKI "Administrasi") prefix, so "band"
    // finds "Kota Bandung" and "jakarta" finds "Kota Administrasi Jakarta Utara".
    searchName: text('search_name')
      .notNull()
      .generatedAlwaysAs(
        sql`lower(regexp_replace(name, '^(Kabupaten|Kota)( Administrasi)? ', ''))`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('regions_code_format', sql`${table.code} ~ '^[0-9]{2}\\.[0-9]{2}$'`),
    check('regions_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    index('regions_province_id_idx').on(table.provinceId),
    // Prefix search (PRD §17.2) uses text_pattern_ops so LIKE 'q%' is indexable under any
    // collation. Trigram/contains search stays optional until measured.
    index('regions_name_lower_idx').using('btree', sql`lower(${table.name}) text_pattern_ops`),
    index('regions_search_name_idx').using('btree', sql`${table.searchName} text_pattern_ops`),
  ],
);

export type ProvinceRow = typeof provinces.$inferSelect;
export type NewProvinceRow = typeof provinces.$inferInsert;
export type RegionRow = typeof regions.$inferSelect;
export type NewRegionRow = typeof regions.$inferInsert;
