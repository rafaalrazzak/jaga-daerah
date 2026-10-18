import { Badge } from '@almach/ui/badge';
import { Card } from '@almach/ui/card';
import type { BudgetModule, MedianComparison } from '@jaga-daerah/contracts';

import { formatPercent, formatRupiahFull, formatRupiahShort } from '@/lib/format';
import { SectionHeader } from './SectionHeader';

const UNAVAILABLE = 'Data belum tersedia';
const COMPARISON_TEXT: Record<MedianComparison, string> = {
  above: 'Di atas median nasional',
  below: 'Di bawah median nasional',
  equal: 'Sama dengan median nasional',
};
const COMPARISON_SYMBOL: Record<MedianComparison, string> = { above: '▲', below: '▼', equal: '■' };

function Amount({ label, amount }: { label: string; amount: string | null }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        {amount === null ? (
          <span className="text-lg font-semibold text-muted-foreground">{UNAVAILABLE}</span>
        ) : (
          <>
            <span className="block font-extrabold tracking-tight text-3xl tabular-nums">
              {formatRupiahShort(amount)}
            </span>
            <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">
              {formatRupiahFull(amount)}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

/** Bar width for a one-decimal percent string, capped so over-100% stays inside the track. */
function width(percent: string): string {
  return `${Math.min(Number(percent), 100)}%`;
}

/**
 * Realisation as a filled share of the budget, with the national median as a tick. Decorative:
 * the same figures are stated in the sentence and the amounts above it.
 */
function RealizationMeter({ percent, median }: { percent: string; median: string | null }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      <div className="relative h-4 rounded-full bg-muted">
        <div className="h-4 rounded-full bg-primary" style={{ width: width(percent) }} />
        {median === null ? null : (
          <div
            className="absolute -top-1.5 h-7 w-0.5 bg-foreground"
            style={{ left: width(median) }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span>100% anggaran</span>
      </div>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-5 rounded-full bg-primary" /> Sudah dibelanjakan
        </span>
        {median === null ? null : (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-0.5 bg-foreground" /> Median nasional{' '}
            {formatPercent(median)}
          </span>
        )}
      </p>
    </div>
  );
}

export function BudgetSection({ budget, year }: { budget: BudgetModule; year: number }) {
  return (
    <section aria-labelledby="modul-anggaran" className="scroll-mt-6 space-y-4">
      <SectionHeader
        id="modul-anggaran"
        title="Anggaran belanja daerah"
        meta={`APBD ${year} · tingkat kabupaten/kota`}
      />

      <Card className="space-y-6 rounded-2xl p-6 shadow-none sm:p-8">
        <div className="space-y-2 text-lg leading-relaxed">
          {budget.narrative.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>

        {budget.realization_percent === null ? null : (
          <RealizationMeter
            percent={budget.realization_percent}
            median={budget.national_median_percent}
          />
        )}

        <dl className="grid gap-6 sm:grid-cols-3">
          <Amount label="Anggaran belanja" amount={budget.budget_amount} />
          <Amount label="Sudah dibelanjakan (realisasi)" amount={budget.realization_amount} />
          <div>
            <dt className="text-sm text-muted-foreground">Persentase realisasi</dt>
            <dd className="mt-1">
              {budget.realization_percent === null ? (
                <span className="text-lg font-semibold text-muted-foreground">
                  Data tidak cukup
                </span>
              ) : (
                <span className="block font-extrabold tracking-tight text-3xl tabular-nums">
                  {formatPercent(budget.realization_percent)}
                </span>
              )}
              {budget.median_comparison !== null && budget.national_median_percent !== null ? (
                <Badge variant="outline" className="mt-2 gap-1">
                  <span aria-hidden="true">{COMPARISON_SYMBOL[budget.median_comparison]}</span>
                  {COMPARISON_TEXT[budget.median_comparison]} (
                  {formatPercent(budget.national_median_percent)})
                </Badge>
              ) : null}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-muted-foreground">
          Pembanding: median persentase realisasi seluruh kabupaten/kota yang datanya lengkap pada
          tahun yang sama. Label ini menggambarkan posisi relatif, bukan penilaian kinerja.
        </p>
      </Card>
    </section>
  );
}
