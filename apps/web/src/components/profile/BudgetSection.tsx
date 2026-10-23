import type { BudgetModule, MedianComparison } from '@jaga-daerah/contracts';

import { Section, Stat } from '@/components/ui/Primitives';
import { Term } from '@/components/ui/Term';
import { formatPercent, formatRupiahFull, formatRupiahShort } from '@/lib/format';

const COMPARISON_TEXT: Record<MedianComparison, string> = {
  above: 'Di atas median nasional',
  below: 'Di bawah median nasional',
  equal: 'Sama dengan median nasional',
};
const COMPARISON_SYMBOL: Record<MedianComparison, string> = { above: '▲', below: '▼', equal: '■' };

/** Bar width for a one-decimal percent string, capped so over-100% stays inside the track. */
function width(percent: string): string {
  return `${Math.min(Number(percent), 100)}%`;
}

/**
 * Realisation as a filled share of the budget, with the national median as a tick. Decorative:
 * the same figures are stated in the sentence and the amounts beside it.
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
        <span className="sm:ml-auto">Penuh = 100% anggaran</span>
      </p>
    </div>
  );
}

function short(value: string | null): string | null {
  return value === null ? null : formatRupiahShort(value);
}

function full(value: string | null): string | undefined {
  return value === null ? undefined : formatRupiahFull(value);
}

export function BudgetSection({ budget, year }: { budget: BudgetModule; year: number }) {
  const comparison = budget.median_comparison;
  const median = budget.national_median_percent;

  return (
    <Section
      id="modul-anggaran"
      title="Anggaran belanja daerah"
      meta={`APBD ${year} · tingkat kabupaten/kota`}
      lead="Rencana belanja, dan yang sudah dibayar."
    >
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6">
        <div className="space-y-2 text-lg leading-relaxed">
          {budget.narrative.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>

        {budget.realization_percent === null ? null : (
          <RealizationMeter percent={budget.realization_percent} median={median} />
        )}

        <dl className="grid gap-6 sm:grid-cols-3">
          <Stat
            label="Anggaran belanja"
            value={short(budget.budget_amount)}
            note={full(budget.budget_amount)}
          />
          <Stat
            label="Sudah dibelanjakan (realisasi)"
            value={short(budget.realization_amount)}
            note={full(budget.realization_amount)}
          />
          <Stat
            label="Persentase realisasi"
            value={
              budget.realization_percent === null ? null : formatPercent(budget.realization_percent)
            }
            missing="Data tidak cukup"
            note={
              comparison !== null && median !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-transparent border border-border px-3 py-1 text-xs font-semibold text-foreground mt-1">
                  <span aria-hidden="true">{COMPARISON_SYMBOL[comparison]}</span>
                  {COMPARISON_TEXT[comparison]} ({formatPercent(median)})
                </span>
              ) : undefined
            }
          />
        </dl>

        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
          <Term id="realisasi" />
          <Term id="median-nasional" />
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          Pembanding: median persentase realisasi seluruh kabupaten/kota yang datanya lengkap pada
          tahun yang sama. Label ini menggambarkan posisi relatif, bukan penilaian kinerja.
        </p>
      </div>
    </Section>
  );
}
