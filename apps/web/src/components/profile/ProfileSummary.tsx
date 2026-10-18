import type { RegionProfile } from '@jaga-daerah/contracts';

import { formatCount, formatPercent, formatRupiahShort } from '@/lib/format';

interface Tile {
  href: string;
  label: string;
  value: string;
  detail: string;
}

function tiles(profile: RegionProfile): Tile[] {
  const { budget, natural_resources: resources, disaster, year } = profile;
  return [
    {
      href: '#modul-anggaran',
      label: `Belanja terpakai ${year}`,
      value: budget.realization_percent === null ? '—' : formatPercent(budget.realization_percent),
      detail:
        budget.budget_amount === null
          ? 'Data anggaran belum tersedia'
          : `dari anggaran ${formatRupiahShort(budget.budget_amount)}`,
    },
    {
      href: '#modul-sda',
      label: 'Dana bagi hasil SDA diterima',
      value:
        resources.total_realization_amount === null
          ? '—'
          : formatRupiahShort(resources.total_realization_amount),
      detail:
        resources.by_type.length === 0
          ? 'Tidak tercatat di data TKDD'
          : `dari ${resources.by_type.length} jenis sumber daya alam`,
    },
    {
      href: '#modul-bencana',
      label: `Kejadian bencana ${year}`,
      value: disaster.totals.event_count === null ? '—' : formatCount(disaster.totals.event_count),
      detail: `se-Provinsi ${disaster.province.name}`,
    },
  ];
}

/** Three headline figures in plain words; each links to the section that explains it. */
export function ProfileSummary({ profile }: { profile: RegionProfile }) {
  return (
    <section aria-labelledby="ringkasan" className="space-y-3">
      <h2 id="ringkasan" className="sr-only">
        Ringkasan
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {tiles(profile).map((tile) => (
          <li key={tile.href}>
            <a
              href={tile.href}
              className="rounded-2xl border border-border bg-card p-5 sm:p-6 group flex h-full flex-col transition-colors hover:border-foreground"
            >
              <span className="text-sm text-muted-foreground">{tile.label}</span>
              <span className="text-[1.75rem] leading-tight font-extrabold tracking-tight tabular-nums [overflow-wrap:anywhere] mt-1">
                {tile.value}
              </span>
              <span className="mt-1 text-sm text-muted-foreground">{tile.detail}</span>
              <span className="mt-auto pt-3 text-sm font-semibold text-primary group-hover:underline group-hover:underline-offset-4">
                Lihat penjelasan <span aria-hidden="true">↓</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
