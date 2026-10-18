import { useState } from 'react';

import { ExternalLink } from '@/components/ui/Primitives';
import { AIR_ADVICE, AIR_CATEGORY_ORDER } from '@/lib/air-quality';
import type { AirCategory, NationalAir } from '@jaga-daerah/contracts';

const PAGE = 'https://ispu.kemenlh.go.id/';
const CARD = 'rounded-2xl border border-border bg-card p-5 sm:p-6 lg:col-span-2';

const SCALE_MAX = 300;

const FILL: Record<AirCategory, string> = {
  baik: 'hsl(var(--map-1))',
  sedang: 'hsl(var(--map-2))',
  tidak_sehat: 'hsl(var(--map-3))',
  sangat_tidak_sehat: 'hsl(var(--warning))',
  berbahaya: 'hsl(var(--destructive))',
};

// Widths follow the official ISPU cuts up to the berbahaya line at 300.
const SCALE_BANDS: readonly { id: AirCategory; span: number }[] = [
  { id: 'baik', span: 50 },
  { id: 'sedang', span: 50 },
  { id: 'tidak_sehat', span: 100 },
  { id: 'sangat_tidak_sehat', span: 100 },
];

function worstCategory(air: NationalAir): AirCategory {
  for (const id of AIR_CATEGORY_ORDER.toReversed()) {
    const category = air.categories.find((item) => item.id === id);
    if (category !== undefined && category.count > 0) return id;
  }
  return 'baik';
}

function formatValue(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

function ReadingScale({ value }: { value: number }) {
  const past = value > SCALE_MAX;
  const marker = Math.max(0, Math.min(100, (value / SCALE_MAX) * 100));
  return (
    <div className="mt-4">
      <div
        className="relative h-3"
        role="img"
        aria-label={`Skala ISPU sampai ${SCALE_MAX}. Angka ini ${formatValue(value)}${past ? `, melewati ${SCALE_MAX}` : ''}.`}
      >
        <div className="flex h-full overflow-hidden rounded-full">
          {SCALE_BANDS.map((band) => (
            <span
              key={band.id}
              className="h-full"
              style={{ width: `${(band.span / SCALE_MAX) * 100}%`, background: FILL[band.id] }}
            />
          ))}
        </div>
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${marker}%` }}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {`0 baik · 50 sedang · 100 tidak sehat · 200 sangat tidak sehat · 300 berbahaya${past ? '. Angka ini melewati 300.' : '.'}`}
      </p>
    </div>
  );
}

export function AirQuality({ air }: { air: NationalAir }) {
  const [selected, setSelected] = useState<AirCategory>(() => worstCategory(air));
  const advice = AIR_ADVICE[selected];
  const lead = air.items.find((station) => station.category === selected);

  if (air.status === 'not_configured') {
    return (
      <section aria-labelledby="ispu-indonesia" className={CARD}>
        <h3 id="ispu-indonesia" className="font-bold tracking-tight">
          Indeks udara
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Angka ISPU belum tersambung di server ini. Pembacaan stasiun dan sarannya ada di{' '}
          <ExternalLink href={PAGE}>situs ISPU KLH</ExternalLink>.
        </p>
      </section>
    );
  }

  if (air.status !== 'ok') {
    return (
      <section aria-labelledby="ispu-indonesia" className={CARD}>
        <h3 id="ispu-indonesia" className="font-bold tracking-tight">
          Indeks udara
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Daftar stasiun ISPU tidak dapat dimuat. Buka{' '}
          <ExternalLink href={PAGE}>situs ISPU KLH</ExternalLink>.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="ispu-indonesia" className={CARD}>
      <h3 id="ispu-indonesia" className="font-bold tracking-tight">
        Indeks udara
      </h3>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {air.station_count === 0
          ? 'KLH tidak menayangkan stasiun pada pembaruan ini.'
          : `${air.station_count} stasiun. Satu angka adalah satu stasiun, bukan rata-rata kabupaten.`}
      </p>

      {lead === undefined ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Tidak ada stasiun pada kategori {advice.label.toLocaleLowerCase('id')}.
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-4">
          <p className="text-5xl leading-none font-extrabold tracking-tight tabular-nums">
            <span className="sr-only">ISPU </span>
            {formatValue(lead.value)}
          </p>
          <div className="min-w-0">
            <p className="font-semibold">{lead.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {advice.label} · {lead.pollutant}
              {lead.province === null ? '' : ` · ${lead.province}`}
            </p>
          </div>
        </div>
      )}

      {lead === undefined ? null : <ReadingScale value={lead.value} />}

      <p className="mt-4 text-sm leading-relaxed">{advice.everyone}</p>
      {advice.sensitive === null ? null : (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Kelompok sensitif. </span>
          {advice.sensitive}
        </p>
      )}

      <div className="mt-5">
        <p className="text-sm font-semibold">Sebaran stasiun</p>
        <div
          className="mt-2 flex h-3 overflow-hidden rounded-full bg-secondary"
          role="img"
          aria-label={AIR_CATEGORY_ORDER.map((id) => {
            const count = air.categories.find((item) => item.id === id)?.count ?? 0;
            return `${AIR_ADVICE[id].label} ${count}`;
          }).join(', ')}
        >
          {AIR_CATEGORY_ORDER.map((id) => {
            const count = air.categories.find((item) => item.id === id)?.count ?? 0;
            if (count === 0 || air.station_count === 0) return null;
            return (
              <span
                key={id}
                className="h-full"
                style={{
                  width: `${(count / air.station_count) * 100}%`,
                  background: FILL[id],
                  opacity: selected === id ? 1 : 0.4,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Kategori ISPU">
        {AIR_CATEGORY_ORDER.map((id) => {
          const count = air.categories.find((item) => item.id === id)?.count ?? 0;
          const pressed = selected === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={pressed}
              aria-label={`${AIR_ADVICE[id].label}, ${count} stasiun`}
              onClick={() => setSelected(id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold whitespace-nowrap focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                pressed
                  ? 'bg-foreground text-background'
                  : 'bg-secondary text-foreground hover:bg-accent'
              }`}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: pressed ? 'hsl(var(--background))' : FILL[id] }}
              />
              {AIR_ADVICE[id].label}
              <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Daftar lengkap ada di <ExternalLink href={PAGE}>situs ISPU KLH</ExternalLink>.
      </p>
    </section>
  );
}
