// Tailwind class recipes shared by the Astro components and the React islands, in the same spirit
// as @almach/ui's `badgeVariants`: one definition per look, so a static section and an island never
// drift apart. Components in this folder are the public surface; use these strings directly only
// for table cells and bars, where a wrapper component would add nothing.

export type SurfaceTone = 'card' | 'muted' | 'brand';

const SURFACE: Record<SurfaceTone, string> = {
  card: 'border border-border bg-card',
  muted: 'bg-secondary',
  brand: 'border border-primary/30 bg-accent/60',
};

export function surface(tone: SurfaceTone = 'card'): string {
  return `rounded-2xl p-5 sm:p-6 ${SURFACE[tone]}`;
}

export const textLink =
  'font-semibold text-primary underline underline-offset-4 hover:decoration-2 rounded-sm';

export type LinkButtonVariant = 'primary' | 'outline' | 'soft';

const LINK_BUTTON: Record<LinkButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border bg-card hover:border-foreground',
  soft: 'bg-secondary hover:bg-accent hover:text-primary',
};

/** A link or button that looks like a pill button; always at least 44 px tall. */
export function linkButton(variant: LinkButtonVariant = 'primary', small = false): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-full font-semibold transition-colors ${
    small ? 'px-3 text-xs' : 'px-4 text-sm'
  } ${LINK_BUTTON[variant]}`;
}

export const sectionTitle = 'text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl';
export const eyebrow = 'text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase';
export const statLabel = 'text-sm text-muted-foreground';
export const statValue =
  'text-[1.75rem] leading-tight font-extrabold tracking-tight tabular-nums [overflow-wrap:anywhere]';
export const finePrint = 'text-xs leading-5 text-muted-foreground';

// Data tables style their cells from the root through descendant variants, so table markup stays
// plain semantic HTML. Numeric cells add `table.numeric` (important, to beat the root's alignment).
export const table = {
  root: 'w-full text-sm tabular-nums [&_td]:py-2 [&_td]:align-top [&_th]:py-2 [&_th]:text-left [&_th]:align-top [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:text-muted-foreground [&_tbody_th]:pr-3 [&_tbody_th]:font-normal [&_tbody_tr]:border-t [&_tbody_tr]:border-border',
  numeric: 'pl-4 text-right!',
} as const;

export const bar = {
  track: 'block h-2 rounded-full bg-muted',
  fill: 'block h-full rounded-full bg-primary',
} as const;
