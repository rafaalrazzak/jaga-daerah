import { Card } from '@almach/ui/card';
import type { NaturalResourceModule } from '@jaga-daerah/contracts';

import { formatRupiahFull, formatRupiahShort } from '@/lib/format';
import { SectionHeader } from './SectionHeader';

const TKDD_URL = 'https://djpk.kemenkeu.go.id/portal/data/tkdd';
const UNAVAILABLE = 'Data belum tersedia';

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

  return (
    <section aria-labelledby="modul-sda" className="scroll-mt-6 space-y-4">
      <SectionHeader
        id="modul-sda"
        title="Dana bagi hasil sumber daya alam"
        meta={`TKDD ${year} · tingkat kabupaten/kota`}
      />

      <div
        role="note"
        className="rounded-xl border border-border bg-accent/60 p-4 text-sm leading-relaxed"
      >
        <p className="font-semibold">Ini bukan ukuran kekayaan alam daerah.</p>
        <p className="mt-1">
          Angka di bawah adalah bagian penerimaan negara dari sumber daya alam yang ditransfer ke{' '}
          {regionName} menurut rumus undang-undang. Daerah yang bukan penghasil pun bisa menerimanya
          dari provinsinya.
        </p>
      </div>

      <Card className="space-y-6 rounded-2xl p-6 shadow-none sm:p-8">
        <div className="space-y-2 text-lg leading-relaxed">
          {resources.narrative.slice(0, 1).map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>

        {resources.by_type.length === 0 ? null : (
          <>
            <dl className="grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Total alokasi</dt>
                <dd className="mt-1 font-extrabold tracking-tight text-3xl tabular-nums">
                  {resources.total_budget_amount === null
                    ? UNAVAILABLE
                    : formatRupiahShort(resources.total_budget_amount)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Total realisasi diterima</dt>
                <dd className="mt-1 font-extrabold tracking-tight text-3xl tabular-nums">
                  {resources.total_realization_amount === null
                    ? UNAVAILABLE
                    : formatRupiahShort(resources.total_realization_amount)}
                </dd>
              </div>
            </dl>

            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Tabel dana bagi hasil sumber daya alam"
            >
              <table className="w-full min-w-[30rem] text-left text-sm">
                <caption className="sr-only">
                  Dana bagi hasil sumber daya alam {regionName} tahun {year} per jenis
                </caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 font-semibold">
                      Jenis sumber daya
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Alokasi
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Realisasi
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {resources.by_type.map((row) => (
                    <tr key={row.type} className="border-b border-border last:border-0">
                      <th scope="row" className="py-3 pr-4 align-top font-normal">
                        <span className="block font-semibold">{row.label}</span>
                        <span aria-hidden="true" className="mt-2 block h-2 rounded-full bg-muted">
                          <span
                            className="block h-2 rounded-full bg-primary"
                            style={{
                              width: `${Math.max(share(row.realization_amount, largest), row.realization_amount === null ? 0 : 1)}%`,
                            }}
                          />
                        </span>
                      </th>
                      <td className="py-3 pl-4 text-right align-top">
                        <Money amount={row.budget_amount} />
                      </td>
                      <td className="py-3 pl-4 text-right align-top">
                        <Money amount={row.realization_amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-sm text-muted-foreground">
          Sumber:{' '}
          <a
            href={TKDD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary underline underline-offset-4"
          >
            DJPK Kemenkeu, Portal Data TKDD
            <span className="sr-only"> (membuka tab baru)</span>
          </a>
          . DJPK menampilkan angka dalam miliar rupiah dengan dua desimal, jadi nilai dibulatkan ke
          Rp10 juta terdekat; “Rp0” bisa berarti di bawah Rp5 juta. Mencakup Dana Bagi Hasil SDA
          (minyak bumi, gas bumi, mineral dan batubara, kehutanan, perikanan, panas bumi) dan DBH
          Perkebunan Sawit.
        </p>
      </Card>
    </section>
  );
}
