import { cn } from '@almach/utils';
import type { ExpenditureFunctionModule } from '@jaga-daerah/contracts';

import { Note, Section, UNAVAILABLE } from '@/components/ui/Primitives';
import { table, textLink } from '@/components/ui/styles';
import { formatPercent, formatRupiahFull, formatRupiahShort } from '@/lib/format';

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

export interface FunctionSource {
  year: number;
  note: string;
  url: string;
  page: string;
}

/** Realisasi belanja menurut fungsi (urusan). The year on the heading is the year of the rows. */
export function ExpenditureFunctionSection({
  breakdown,
  regionName,
  source,
}: {
  breakdown: ExpenditureFunctionModule;
  regionName: string;
  source: FunctionSource | null;
}) {
  const showBudget = breakdown.by_function.some((row) => row.budget_amount !== null);

  return (
    <Section
      id="modul-belanja-fungsi"
      title="Realisasi belanja menurut fungsi"
      meta={`Realisasi ${breakdown.year} · tingkat kabupaten/kota`}
      source={
        source !== null && breakdown.by_function.length > 0 ? (
          <>
            <p>
              Sumber:{' '}
              <a href={source.url} className={textLink} target="_blank" rel="noopener noreferrer">
                berkas DJPK Realisasi Belanja Daerah {breakdown.year}
                <span className="sr-only"> (membuka tab baru)</span>
              </a>
              {' · '}
              <a href={source.page} className={textLink} target="_blank" rel="noopener noreferrer">
                seri data DJPK
                <span className="sr-only"> (membuka tab baru)</span>
              </a>
              .
            </p>
          </>
        ) : (
          <p>Fungsi belanja dari data DJPK yang dipublikasikan untuk tahun {breakdown.year}.</p>
        )
      }
    >
      <Note title="Ini urusan belanja, bukan kegiatan.">
        Misalnya pendidikan atau kesehatan. Bukan daftar program, dan bukan daftar dinas.
      </Note>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6">
        {breakdown.by_function.length === 0 ? (
          <div className="space-y-2 text-muted-foreground">
            {breakdown.narrative.slice(0, 1).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        ) : (
          <>
            {breakdown.narrative.slice(0, 1).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
            {breakdown.status === 'complete' ? null : (
              <p className="rounded-2xl bg-secondary p-5 sm:p-6 text-sm">
                Tidak semua fungsi dilaporkan untuk tahun {breakdown.year}. Fungsi yang tidak ada di
                sumber tidak ditampilkan, dan sel kosong ditulis &ldquo;{UNAVAILABLE}&rdquo;, bukan
                nol.
              </p>
            )}
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Tabel realisasi belanja menurut fungsi"
            >
              <table className={cn(table.root, 'min-w-[28rem]')}>
                <caption className="sr-only">
                  Realisasi belanja daerah {regionName} tahun {breakdown.year} menurut fungsi, dalam
                  rupiah. Sumber DJPK.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Fungsi</th>
                    {showBudget ? (
                      <th scope="col" className="pl-4 text-right!">
                        Anggaran
                      </th>
                    ) : null}
                    <th scope="col" className="pl-4 text-right!">
                      Realisasi
                    </th>
                    <th scope="col" className="pl-4 text-right!">
                      Bagian
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.by_function.map((row) => (
                    <tr key={row.type}>
                      <th scope="row">{row.label}</th>
                      {showBudget ? (
                        <td className="pl-4 text-right!">
                          <Money amount={row.budget_amount} />
                        </td>
                      ) : null}
                      <td className="pl-4 text-right!">
                        <Money amount={row.realization_amount} />
                      </td>
                      <td className="pl-4 text-right!">
                        {row.realization_share_percent === null
                          ? UNAVAILABLE
                          : formatPercent(row.realization_share_percent)}
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
