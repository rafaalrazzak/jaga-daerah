import { cn } from '@almach/utils';
import type { NaturalResourceModule } from '@jaga-daerah/contracts';

import { ExternalLink, Note, Section, Stat } from '@/components/ui/Primitives';
import { formatRupiahFull, formatRupiahShort } from '@/lib/format';
import { table } from '@/components/ui/styles';

const TKDD_URL = 'https://djpk.kemenkeu.go.id/portal/data/tkdd';

/** Bar length in whole percent of the largest realisation, computed in BigInt cents. */
function share(amount: string | null, largest: bigint): number {
  if (amount === null || largest === 0n) return 0;
  const cents = BigInt(amount.replace('.', ''));
  return Number((cents * 100n) / largest);
}

function Money({ amount }: { amount: string | null }) {
  if (amount === null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span className="block font-semibold">{formatRupiahShort(amount)}</span>
      <span className="block font-mono text-xs break-all text-muted-foreground">
        {formatRupiahFull(amount)}
      </span>
    </>
  );
}

export function NaturalResourceSection({
  resources,
  regionName,
  year,
}: {
  resources: NaturalResourceModule;
  regionName: string;
  year: number;
}) {
  const largest = resources.by_type.reduce((max, row) => {
    const cents =
      row.realization_amount === null ? 0n : BigInt(row.realization_amount.replace('.', ''));
    return cents > max ? cents : max;
  }, 0n);
  const { total_budget_amount: budget, total_realization_amount: realization } = resources;

  return (
    <Section
      id="modul-sda"
      title="Dana bagi hasil sumber daya alam"
      meta={`TKDD ${year} · tingkat kabupaten/kota`}
      source={
        <p>
          Sumber: <ExternalLink href={TKDD_URL}>DJPK Kemenkeu, Portal Data TKDD</ExternalLink>.
          Angka dibulatkan. Rp0 bisa berarti di bawah Rp5 juta.
        </p>
      }
    >
      <Note title="Ini bukan ukuran kekayaan alam.">
        Bagian penerimaan negara yang ditransfer ke {regionName}. Daerah yang bukan penghasil pun
        bisa menerima bagian dari provinsinya.
      </Note>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6">
        {resources.narrative.slice(0, 1).map((sentence) => (
          <p key={sentence} className="text-lg leading-relaxed">
            {sentence}
          </p>
        ))}

        {resources.by_type.length === 0 ? null : (
          <>
            <dl className="grid gap-6 sm:grid-cols-2">
              <Stat
                label="Total alokasi"
                value={budget === null ? null : formatRupiahShort(budget)}
              />
              <Stat
                label="Total realisasi diterima"
                value={realization === null ? null : formatRupiahShort(realization)}
              />
            </dl>

            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Tabel dana bagi hasil sumber daya alam"
            >
              <table className={cn(table.root, 'min-w-[30rem]')}>
                <caption className="sr-only">
                  Dana bagi hasil sumber daya alam {regionName} tahun {year} per jenis
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Jenis sumber daya</th>
                    <th scope="col" className="pl-4 text-right!">
                      Alokasi
                    </th>
                    <th scope="col" className="pl-4 text-right!">
                      Realisasi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resources.by_type.map((row) => (
                    <tr key={row.type}>
                      <th scope="row" className="pr-4">
                        <span className="block font-semibold">{row.label}</span>
                        <span aria-hidden="true" className="block h-2 rounded-full bg-muted mt-2">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.max(share(row.realization_amount, largest), row.realization_amount === null ? 0 : 1)}%`,
                            }}
                          />
                        </span>
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
