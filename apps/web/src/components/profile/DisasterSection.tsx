import { Alert } from '@almach/ui/alert';
import { Card } from '@almach/ui/card';
import type { DisasterModule } from '@jaga-daerah/contracts';

import { formatCount } from '@/lib/format';
import { SectionHeader } from './SectionHeader';

const UNAVAILABLE = 'Data belum tersedia';
const TOP_TYPES = 5;

function count(value: number | null): string {
  return value === null ? '—' : formatCount(value);
}

export function DisasterSection({ disaster, year }: { disaster: DisasterModule; year: number }) {
  const ranked = disaster.by_type
    .filter((row) => (row.event_count ?? 0) > 0)
    .toSorted((left, right) => (right.event_count ?? 0) - (left.event_count ?? 0))
    .slice(0, TOP_TYPES);
  const largest = ranked[0]?.event_count ?? 0;

  return (
    <section aria-labelledby="modul-bencana" className="scroll-mt-6 space-y-4">
      <SectionHeader
        id="modul-bencana"
        title="Kejadian bencana"
        meta={`BNPB ${year} · tingkat provinsi`}
      />

      <Alert>
        <Alert.Body>
          <Alert.Title>Data tingkat provinsi: {disaster.province.name}</Alert.Title>
          <Alert.Description>
            Angka bencana berlaku untuk seluruh Provinsi {disaster.province.name}, bukan khusus
            kabupaten/kota ini.
          </Alert.Description>
        </Alert.Body>
      </Alert>

      <Card className="space-y-6 rounded-2xl p-6 shadow-none sm:p-8">
        {disaster.status === 'unavailable' ? (
          <p className="text-lg text-muted-foreground">
            {UNAVAILABLE} untuk Provinsi {disaster.province.name} tahun {year}.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {(
                [
                  ['Jumlah kejadian', disaster.totals.event_count],
                  ['Korban meninggal', disaster.totals.deaths],
                  ['Korban hilang', disaster.totals.missing],
                  ['Korban terdampak', disaster.totals.affected],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-extrabold tracking-tight text-2xl tabular-nums sm:text-3xl">
                    {value === null ? (
                      <span className="text-base text-muted-foreground">{UNAVAILABLE}</span>
                    ) : (
                      formatCount(value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {ranked.length > 0 ? (
              <figure className="space-y-3">
                <figcaption className="text-sm font-semibold">
                  {ranked.length} jenis bencana terbanyak di Provinsi {disaster.province.name},{' '}
                  {year} (jumlah kejadian)
                </figcaption>
                {/* Each bar is labelled with its own number, so the list reads well without the bars. */}
                <ol className="space-y-3">
                  {ranked.map((row) => (
                    <li
                      key={row.type}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
                    >
                      <span className="text-sm">{row.label}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {count(row.event_count)} kejadian
                      </span>
                      <span
                        aria-hidden="true"
                        className="col-span-2 block h-2.5 rounded-full bg-muted"
                      >
                        <span
                          className="block h-2.5 rounded-full bg-primary"
                          style={{
                            width: `${largest === 0 ? 0 : Math.max(((row.event_count ?? 0) / largest) * 100, 2)}%`,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ol>
              </figure>
            ) : null}

            <details className="group rounded-xl border border-border">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm font-semibold">
                Lihat rincian semua jenis bencana dan korban
                <span aria-hidden="true" className="transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              {/* Focusable so keyboard users can scroll the wide table on small screens. */}
              <div
                className="overflow-x-auto border-t border-border px-4 py-3"
                tabIndex={0}
                role="region"
                aria-label={`Tabel rincian bencana Provinsi ${disaster.province.name}`}
              >
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <caption className="pb-2 text-left text-sm font-semibold">
                    Rincian per jenis bencana, Provinsi {disaster.province.name} {year}
                  </caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 font-semibold">
                        Jenis bencana
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Kejadian
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Meninggal
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Hilang
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Terdampak
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {disaster.by_type.map((row) => (
                      <tr key={row.type} className="border-b border-border last:border-0">
                        <th scope="row" className="py-2 font-normal">
                          {row.label}
                        </th>
                        <td className="py-2 text-right">{count(row.event_count)}</td>
                        <td className="py-2 text-right">{count(row.deaths)}</td>
                        <td className="py-2 text-right">{count(row.missing)}</td>
                        <td className="py-2 text-right">{count(row.affected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Tanda — berarti data belum tersedia di sumber.
                </p>
              </div>
            </details>
          </>
        )}

        {disaster.notes.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Catatan sumber data</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {disaster.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
