import { Badge } from '@almach/ui/badge';
import { cn } from '@almach/utils';
import type { ReactNode } from 'react';

import {
  finePrint,
  linkButton,
  sectionTitle,
  statLabel,
  statValue,
  surface,
  textLink,
} from '@/components/ui/styles';
import type { LinkButtonVariant, SurfaceTone } from '@/components/ui/styles';

// React twins of the Astro components in this folder (Section, Surface, Stat, ExternalLink, Note,
// Disclosure), built from the same recipes in `styles.ts` so islands and static sections match.

export const UNAVAILABLE = 'Data belum tersedia';

export function Section({
  id,
  title,
  meta,
  lead,
  source,
  children,
}: {
  id: string;
  title: string;
  meta?: string;
  lead?: string;
  source?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-32 space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={id} className={sectionTitle}>
            {title}
          </h2>
          {meta === undefined ? null : (
            <Badge variant="ghost" className="rounded-full">
              {meta}
            </Badge>
          )}
        </div>
        {lead === undefined ? null : <p className="max-w-3xl text-muted-foreground">{lead}</p>}
      </header>
      {children}
      {source === undefined ? null : (
        <footer className={cn(finePrint, 'space-y-1 border-t border-border pt-4')}>{source}</footer>
      )}
    </section>
  );
}

export function Surface({
  tone = 'card',
  className,
  children,
}: {
  tone?: SurfaceTone;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(surface(tone), className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  unit,
  note,
  missing = UNAVAILABLE,
}: {
  label: string;
  value: string | null;
  unit?: string;
  note?: ReactNode;
  missing?: string;
}) {
  return (
    <div>
      <dt className={statLabel}>{label}</dt>
      <dd className="mt-1">
        {value === null ? (
          <span className="text-base font-semibold text-muted-foreground">{missing}</span>
        ) : (
          <span className={statValue}>
            {value}
            {unit === undefined ? null : <span className="text-base font-bold"> {unit}</span>}
          </span>
        )}
        {note === undefined ? null : <span className={cn(finePrint, 'mt-1 block')}>{note}</span>}
      </dd>
    </div>
  );
}

export function ExternalLink({
  href,
  button,
  small = false,
  className,
  children,
}: {
  href: string;
  /** Omit for an inline text link; pass a variant for a pill button. */
  button?: LinkButtonVariant;
  small?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(button === undefined ? textLink : linkButton(button, small), className)}
    >
      {children}
      <span className="sr-only"> (membuka tab baru)</span>
    </a>
  );
}

export function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="note" className={cn(surface('muted'), 'text-sm leading-relaxed')}>
      {title === undefined ? null : <p className="font-semibold">{title}</p>}
      <div className={cn('text-muted-foreground', title !== undefined && 'mt-1')}>{children}</div>
    </div>
  );
}

export function Disclosure({
  summary,
  className,
  children,
}: {
  summary: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn('group', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      {children}
    </details>
  );
}

/** Small pulsing dot marking live data; the pulse is dropped under reduced motion. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0', className)}>
      <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
}
