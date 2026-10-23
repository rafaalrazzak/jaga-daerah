import { cn } from '@almach/utils';
import { Alert } from '@almach/ui/alert';
import type { DisasterModule } from '@jaga-daerah/contracts';

import { Disclosure, Section, Stat, UNAVAILABLE } from '@/components/ui/Primitives';
import { Term } from '@/components/ui/Term';
import { formatCount } from '@/lib/format';
import { table } from '@/components/ui/styles';

const TOP_TYPES = 5;

function count(value: number | null): string {
  return value === null ? '—' : formatCount(value);
}

export function DisasterSection({ disaster, year }: { disaster: DisasterModule; year: number }) {
  const province = disaster.province.name;
  const ranked = disaster.by_type
    .filter((row) => (row.event_count ?? 0) > 0)
    .toSorted((left, right) => (right.event_count ?? 0) - (left.event_count ?? 0))
    .slice(0, TOP_TYPES);
  const largest = ranked[0]?.event_count ?? 0;

  return (
    <Section id="modul-bencana" title="Kejadian bencana" meta={`BNPB ${year} · tingkat provinsi`}>
      <Alert>
        <Alert.Body>
          <Alert.Title>Data tingkat provinsi: {province}</Alert.Title>
          <Alert.Description>
            Angka ini untuk seluruh Provinsi {province}, bukan hanya kabupaten ini.
          </Alert.Description>
        </Alert.Body>
      </Alert>

      <div className="grid gap-2">
        <Term id="bencana-provinsi" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6">
        {disaster.status === 'unavailable' ? (
          <p className="text-lg text-muted-foreground">
            {UNAVAILABLE} untuk Provinsi {province} tahun {year}.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Jumlah kejadian" value={stat(disaster.totals.event_count)} />
              <Stat label="Korban meninggal" value={stat(disaster.totals.deaths)} />
              <Stat label="Korban hilang" value={stat(disaster.totals.missing)} />
              <Stat label="Korban terdampak" value={stat(disaster.totals.affected)} />
            </dl>

            {ranked.length > 0 ? (
              <figure className="space-y-3">
                <figcaption className="text-sm font-semibold">
                  {ranked.length} jenis bencana terbanyak di Provinsi {province}, {year} (jumlah
                  kejadian)
                </figcaption>
                {/* Each bar is labelled with its own number, so the list reads well without bars. */}
                <ol className="space-y-3">
                  {ranked.map((row) => (
                    <li
                      key={row.type}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm"
                    >
                      <span>{row.label}</span>
                      <span className="font-semibold tabular-nums">
                        {count(row.event_count)} kejadian
                      </span>
                      <span
                        aria-hidden="true"
                        className="block h-2 rounded-full bg-muted col-span-2"
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
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

            <Disclosure
              summary="Lihat rincian semua jenis bencana dan korban"
              className="border-t border-border pt-2"
            >
              {/* Focusable so keyboard users can scroll the wide table on small screens. */}
              <div
                className="overflow-x-auto pb-2"
                tabIndex={0}
                role="region"
                aria-label={`Tabel rincian bencana Provinsi ${province}`}
              >
                <table className={cn(table.root, 'min-w-[32rem]')}>
                  <caption className="pb-2 text-left text-sm font-semibold">
                    Rincian per jenis bencana, Provinsi {province} {year}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Jenis bencana</th>
                      <th scope="col" className="pl-4 text-right!">
                        Kejadian
                      </th>
                      <th scope="col" className="pl-4 text-right!">
                        Meninggal
                      </th>
                      <th scope="col" className="pl-4 text-right!">
                        Hilang
                      </th>
                      <th scope="col" className="pl-4 text-right!">
                        Terdampak
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {disaster.by_type.map((row) => (
                      <tr key={row.type}>
                        <th scope="row">{row.label}</th>
                        <td className="pl-4 text-right!">{count(row.event_count)}</td>
                        <td className="pl-4 text-right!">{count(row.deaths)}</td>
                        <td className="pl-4 text-right!">{count(row.missing)}</td>
                        <td className="pl-4 text-right!">{count(row.affected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs leading-5 text-muted-foreground mt-2">
                  Tanda — berarti data belum tersedia di sumber.
                </p>
              </div>
            </Disclosure>
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
      </div>
    </Section>
  );
}

function stat(number: number | null): string | null {
  return number === null ? null : formatCount(number);
}
