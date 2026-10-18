/** Shared heading for profile modules: title plus the geographic level and period it covers. */
export function SectionHeader({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
        {title}
      </h2>
      <p className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
        {meta}
      </p>
    </div>
  );
}
