import { cn } from '@almach/utils';
import type { ReactNode } from 'react';

import { glossaryEntry } from '@/lib/glossary';

/**
 * Inline definition for a term used in a profile. `<details>` is used instead of a hover-only
 * tooltip so the definition is reachable by keyboard and by touch, and still works before the
 * island hydrates.
 */
export function Term({
  id,
  children,
  className,
}: {
  id: string;
  /** Visible label; defaults to the glossary label. */
  children?: ReactNode;
  className?: string;
}) {
  const entry = glossaryEntry(id);

  return (
    <details className={cn('group inline-block max-w-full align-baseline', className)}>
      <summary className="inline-flex min-h-6 cursor-help list-none items-baseline gap-1 rounded-sm text-sm font-semibold text-primary underline decoration-dotted underline-offset-4 hover:decoration-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {children ?? entry.label}
        <span
          aria-hidden="true"
          className="inline-flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-full border border-primary/40 text-[10px] leading-none"
        >
          ?
        </span>
      </summary>
      <span className="mt-2 block max-w-md rounded-xl border border-border bg-card p-3 text-sm leading-relaxed font-normal text-foreground shadow-xs">
        {entry.definition}
        {entry.note === undefined ? null : (
          <span className="mt-1 block text-muted-foreground">{entry.note}</span>
        )}
        <a
          href="#glosarium"
          className="mt-2 inline-flex min-h-6 items-center text-xs font-semibold text-primary underline underline-offset-4"
        >
          Semua istilah
        </a>
      </span>
    </details>
  );
}
