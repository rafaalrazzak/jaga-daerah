import type { CSSProperties } from 'react';

export interface MapLegendItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  pressed: boolean;
  swatchClass: string;
  swatchStyle?: CSSProperties;
}

/** Colour key that hugs its label. Counts sit beside the name, so a wide page does not open a gap. */
export function MapLegend({
  label,
  items,
  onToggle,
}: {
  label: string;
  items: readonly MapLegendItem[];
  onToggle: (key: string) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label={label}>
      {items.map((entry) => (
        <li key={entry.key} className="max-w-full min-w-0">
          <button
            type="button"
            aria-pressed={entry.pressed}
            onClick={() => onToggle(entry.key)}
            className="flex min-h-11 max-w-full items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2 text-left text-sm hover:border-foreground aria-pressed:border-foreground aria-pressed:bg-secondary"
          >
            <svg aria-hidden="true" className="size-3.5 shrink-0 rounded-sm" viewBox="0 0 20 20">
              <rect
                width="20"
                height="20"
                className={entry.swatchClass}
                style={entry.swatchStyle}
              />
            </svg>
            <span className="min-w-0 leading-tight">
              <span className="block font-semibold">{entry.label}</span>
              <span className="block text-xs text-muted-foreground">{entry.hint}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">{entry.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
