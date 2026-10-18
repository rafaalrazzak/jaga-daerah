import { cn } from '@almach/utils';
import type { ExpenditureBreakdownModule } from '@jaga-daerah/contracts';

import { Note, Section, Stat, UNAVAILABLE } from '@/components/ui/Primitives';
import { formatPercent, formatRupiahFull, formatRupiahShort } from '@/lib/format';
import { table } from '@/components/ui/styles';

function Money({ amount }: { amount: string | null }) {
  if (amount === null) return <span className="text-muted-foreground">{UNAVAILABLE}</span>;
  return (
    <>
      <span className="block font-semibold">{formatRupiahShort(amount)}</span>
      <span className="text-xs leading-5 text-muted-foreground block break-all">
        {formatRupiahFull(amount)}
      </span>
    </>
  );
}

/** Belanja Daerah by jenis belanja (standard APBD classification); a blank is never shown as 0. */
export function ExpenditureSection({
  breakdown,
  regionName,
  year,
}: {
  breakdown: ExpenditureBreakdownModule;
  regionName: string;
  year: number;
}) {
  const totalBudget = breakdown.total_budget_amount;
  const totalRealization = breakdown.total_realization_amount;

  return (
    <Section
      id="modul-rincian-belanja"
      title="Rincian belanja menurut jenis"
      meta={`APBD ${year} · tingkat kabupaten/kota`}
    >
      <Note title="Ini bukan belanja per program.">
        Jenis belanja, misalnya pegawai atau barang. Bukan daftar kegiatan di {regionName}.
      </Note>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6">
        {breakdown.by_type.length === 0 ? (
          <div className="space-y-2 text-muted-foreground">
            {breakdown.narrative.slice(0, 1).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        ) : (
          <>
            <dl className="grid gap-6 sm:grid-cols-2">
              <Stat
                label={`Anggaran ${year}`}
                value={totalBudget === null ? null : formatRupiahShort(totalBudget)}
              />
              <Stat
                label={`Realisasi ${year}`}
                value={totalRealization === null ? null : formatRupiahShort(totalRealization)}
              />
            </dl>
            {breakdown.status === 'complete' ? null : (
              <p className="rounded-2xl bg-secondary p-5 sm:p-6 text-sm">
                Tidak semua jenis belanja dilaporkan sumber untuk tahun {year}; baris kosong ditulis
                &ldquo;{UNAVAILABLE}&rdquo;, bukan nol.
              </p>
            )}
            {/* Focusable so keyboard users can scroll the table on small screens. */}
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Tabel rincian belanja menurut jenis"
            >
              <table className={cn(table.root, 'min-w-[30rem]')}>
                <caption className="sr-only">
                  Rincian belanja daerah {regionName} tahun {year} menurut jenis belanja, dalam
                  rupiah. Sumber DJPK.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Jenis belanja</th>
                    <th scope="col" className="pl-4 text-right!">
                      Anggaran
                    </th>
                    <th scope="col" className="pl-4 text-right!">
                      Realisasi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.by_type.map((row) => (
                    <tr key={row.type}>
                      <th scope="row">
                        <span className="block font-semibold">{row.label}</span>
                        {row.budget_share_percent === null ? null : (
                          <span className="text-xs leading-5 text-muted-foreground block">
                            {formatPercent(row.budget_share_percent)} dari total anggaran
                          </span>
                        )}
                      </th>
                      <td className="pl-4 text-right! pl-4">
                        <Money amount={row.budget_amount} />
                      </td>
                      <td className="pl-4 text-right! pl-4">
                        <Money amount={row.realization_amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
