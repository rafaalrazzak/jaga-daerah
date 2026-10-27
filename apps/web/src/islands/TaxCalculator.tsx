import { useState } from 'react';
import type { ExpenditureRow } from '@jaga-daerah/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { formatCount } from '@/lib/format';
import { createQueryClient, profileQueryKeys } from '@/lib/query-client';

interface TaxCalculatorProps {
  slug: string;
  regionName: string;
}

const PRESETS = [
  { label: 'Rp250 rb', value: 250000, note: 'Pajak motor / PBB rumah sederhana' },
  { label: 'Rp500 rb', value: 500000, note: 'Pajak mobil kecil / PBB rumah' },
  { label: 'Rp1 juta', value: 1000000, note: 'Pajak kendaraan / PBB ruko' },
  { label: 'Rp2,5 juta', value: 2500000, note: 'Pajak usaha / kendaraan' },
];

const MAX_DIGITS = 15;

export default function TaxCalculator({ slug, regionName }: TaxCalculatorProps) {
  // Digits only, so the field can be empty instead of snapping back to "0" while typing.
  const [taxInput, setTaxInput] = useState<string>('500000');
  const taxAmount = taxInput === '' ? 0 : Number.parseInt(taxInput, 10);

  const profileQuery = useQuery(
    {
      queryKey: profileQueryKeys.region(slug, undefined),
      queryFn: ({ signal }) => apiClient.getRegionProfile(slug, { signal }),
    },
    createQueryClient(),
  );

  // Extract real percentages from expenditure rows if available
  const expRows: ExpenditureRow[] = profileQuery.data?.data?.expenditure_breakdown?.by_type ?? [];
  const modalRow = expRows.find((r: ExpenditureRow) => r.type === 'belanja_modal');
  const pegawaiRow = expRows.find((r: ExpenditureRow) => r.type === 'belanja_pegawai');
  const barangJasaRow = expRows.find((r: ExpenditureRow) => r.type === 'belanja_barang_dan_jasa');
  const bansosRow = expRows.find((r: ExpenditureRow) => r.type === 'belanja_bantuan_sosial');
  const takTerdugaRow = expRows.find((r: ExpenditureRow) => r.type === 'belanja_tidak_terduga');

  const modalPct = modalRow?.realization_share_percent
    ? Number.parseFloat(modalRow.realization_share_percent)
    : 15;
  const pegawaiPct = pegawaiRow?.realization_share_percent
    ? Number.parseFloat(pegawaiRow.realization_share_percent)
    : 36;
  const barangJasaPct = barangJasaRow?.realization_share_percent
    ? Number.parseFloat(barangJasaRow.realization_share_percent)
    : 24;
  const bansosPct = bansosRow?.realization_share_percent
    ? Number.parseFloat(bansosRow.realization_share_percent)
    : 5;
  const takTerdugaPct = takTerdugaRow?.realization_share_percent
    ? Number.parseFloat(takTerdugaRow.realization_share_percent)
    : 4;

  const categories = [
    {
      title: 'Pembangunan Infrastruktur & Fasilitas Publik',
      subtitle: 'Belanja Modal: jalan, jembatan, drainase banjir, gedung sekolah & RS baru',
      percent: modalPct,
      amount: Math.round((taxAmount * modalPct) / 100),
      color: 'bg-emerald-500',
      badgeBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    {
      title: 'Gaji Guru, Tenaga Medis & Pegawai Pemda',
      subtitle: 'Belanja Pegawai: gaji dan tunjangan ASN, guru sekolah, dan tenaga kesehatan',
      percent: pegawaiPct,
      amount: Math.round((taxAmount * pegawaiPct) / 100),
      color: 'bg-blue-500',
      badgeBg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    },
    {
      title: 'Operasional Layanan & Pemeliharaan',
      subtitle:
        'Belanja Barang & Jasa: obat puskesmas, penerangan jalan umum, listrik fasilitas publik',
      percent: barangJasaPct,
      amount: Math.round((taxAmount * barangJasaPct) / 100),
      color: 'bg-amber-500',
      badgeBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    },
    {
      title: 'Bantuan Sosial & Hibah Warga',
      subtitle: 'Bantuan sosial warga rentan, santunan disabilitas, dan program pemberdayaan',
      percent: bansosPct,
      amount: Math.round((taxAmount * bansosPct) / 100),
      color: 'bg-purple-500',
      badgeBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
    },
    {
      title: 'Cadangan Darurat Bencana & Krisis',
      subtitle: 'Belanja Tidak Terduga: penanggulangan tanggap darurat bencana alam BNPB/BPBD',
      percent: takTerdugaPct,
      amount: Math.round((taxAmount * takTerdugaPct) / 100),
      color: 'bg-rose-500',
      badgeBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    },
  ];

  return (
    <section
      aria-labelledby="tax-calc-heading"
      className="scroll-mt-32 rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-xs"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-foreground">
            Kalkulator Warga
          </span>
          <h3
            id="tax-calc-heading"
            className="mt-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
          >
            Ke Mana Larinya Uang Pajak Saya di {regionName}?
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulasi proporsi pembagian uang pajak daerah (PBB, PKB, retribusi) berdasarkan alokasi
            riil APBD {regionName}.
          </p>
        </div>
      </div>

      {/* Input Nominal Pajak */}
      <div className="mt-6 rounded-2xl border border-border/80 bg-secondary/40 p-4 sm:p-5">
        <label
          htmlFor="tax-input"
          className="block text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          Masukkan Perkiraan Pajak Daerah yang Anda Bayar:
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 font-bold text-muted-foreground">
              Rp
            </span>
            <input
              id="tax-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={taxInput === '' ? '' : formatCount(taxAmount)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                setTaxInput(digits.slice(0, MAX_DIGITS));
              }}
              className="min-h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 text-base font-extrabold text-foreground shadow-2xs outline-hidden focus:border-primary"
            />
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setTaxInput(String(p.value))}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                  taxAmount === p.value
                    ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                    : 'border-border bg-background text-foreground hover:bg-secondary'
                }`}
                title={p.note}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Proportional Stack Bar */}
      <div className="mt-6">
        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-secondary">
          {categories.map((c) => (
            <div
              key={c.title}
              style={{ width: `${c.percent}%` }}
              className={`${c.color} transition-all duration-300`}
              title={`${c.title}: ${c.percent.toFixed(1)}%`}
            />
          ))}
        </div>
      </div>

      {/* Breakdown list */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {categories.map((c) => (
          <div
            key={c.title}
            className="flex flex-col justify-between gap-2 rounded-2xl border border-border/60 bg-background/60 p-4 transition-all hover:bg-secondary/30 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 size-3 shrink-0 rounded-full ${c.color}`} />
              <div>
                <h4 className="text-sm font-bold text-foreground">{c.title}</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.subtitle}</p>
              </div>
            </div>

            <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
              <span className="text-base font-black text-foreground">
                Rp{formatCount(c.amount)}
              </span>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${c.badgeBg}`}>
                {c.percent.toFixed(1)}% dari APBD
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        *Perhitungan ini merupakan simulasi pembagian proporsional belanja APBD resmi dari DJPK
        Kementerian Keuangan.
      </p>
    </section>
  );
}
