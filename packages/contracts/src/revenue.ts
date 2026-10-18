import { z } from 'zod';

import { RupiahSchema } from './profile';

export const RevenueLineSchema = z.enum([
  'pajak_daerah',
  'retribusi_daerah',
  'hasil_kekayaan_dipisahkan',
  'lain_lain_pad',
  'transfer_pemerintah_pusat',
  'transfer_antar_daerah',
  'hibah',
  'dana_darurat',
  'lain_lain_pendapatan',
]);

const REGION = z.string().regex(/^[0-9]{2}\.[0-9]{2}$/);

export const RevenueFileSchema = z.object({
  year: z.literal(2024),
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    page: z.url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    downloaded_at: z.iso.datetime({ offset: true }),
  }),
  labels: z.record(RevenueLineSchema, z.string().min(1)),
  note: z.string().min(1),
  regions: z.record(
    REGION,
    z.object({
      total_amount: RupiahSchema,
      rows: z.array(
        z.object({
          type: RevenueLineSchema,
          amount: RupiahSchema,
        }),
      ),
    }),
  ),
});

export type RevenueFile = z.infer<typeof RevenueFileSchema>;
export type RevenueLine = z.infer<typeof RevenueLineSchema>;
