import { z } from 'zod';

// Declared wealth figures published by KPK, exported by tools/etl `jaga_etl.lhkpn` from pages a human
// saved by hand from the e-LHKPN e-Announcement search. The pipeline never fetches the source: the
// form is CAPTCHA-gated (docs/decisions/0003). Only what KPK itself publishes is kept — public name,
// position, institution, reporting year, and the announced total — while NIK, addresses, report ids,
// and the itemised asset/debt detail views are dropped at extraction (docs/SECURITY.md).
//
// ADR 0003 requires four labels on every figure together, from the same record: the reporting year,
// the position held in that year, the source, and the processing date. A figure missing one of them
// is not published, so they are required here rather than nullable.
export const LhkpnReportSchema = z.object({
  // The reporting year the declaration covers (1 January – 31 December), never a live balance.
  year: z.number().int().min(2000).max(2100),
  // The office held in that reporting year; never the incumbent's current title by implication.
  position: z.string().min(1),
  // KPK's own announced total: its comparison view prints "TOTAL HARTA KEKAYAAN (I-II)", i.e. assets
  // minus declared debt. A decimal string, never a JavaScript number (PRD §17.3).
  total_assets: z.string().regex(/^\d{1,18}\.\d{2}$/, 'Nilai rupiah tidak valid.'),
  report_type: z.string().min(1),
  source: z.url(),
  // KPK's per-announcement id from the row's hidden cell: what ties the record to one published row.
  announcement_id: z.string().regex(/^[0-9a-f]{8}$/),
  reported_on: z.string().min(1).nullable(),
});

export const LhkpnFileSchema = z.object({
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    processed_at: z.iso.datetime({ offset: true }),
  }),
  regions: z.record(
    z.string().regex(/^[0-9]{2}\.[0-9]{2}$/),
    z.object({
      region_code: z.string().regex(/^[0-9]{2}\.[0-9]{2}$/),
      // KPK's institution name as published; the region join key, resolved through the reviewed
      // tools/etl/reference/lhkpn-institutions.csv and never through a person's name.
      lembaga: z.string().min(1),
      // The single official the capture is about (the regional head the worklist asked for).
      official: z.string().min(1),
      // Every reporting year found in the capture, oldest first; empty never occurs (the gate blocks).
      reports: z.array(LhkpnReportSchema).min(1),
      // The newest report for the office held now. Labelled by its own report year in the UI: no
      // figure is ever presented as current wealth.
      latest: LhkpnReportSchema,
      capture_file: z.string().min(1),
      capture_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      downloaded_at: z.iso.datetime({ offset: true }),
      processed_at: z.iso.datetime({ offset: true }),
      // The net-total caveat: KPK's figure already subtracts declared debt, and JagaDaerah is not
      // the publisher and this is not an audit result.
      notes: z.string().min(1),
    }),
  ),
});

export type LhkpnReport = z.infer<typeof LhkpnReportSchema>;
export type LhkpnRegion = z.infer<typeof LhkpnFileSchema>['regions'][string];
export type LhkpnFile = z.infer<typeof LhkpnFileSchema>;
