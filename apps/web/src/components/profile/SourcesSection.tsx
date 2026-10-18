import type { Source } from '@jaga-daerah/contracts';

import { ExternalLink, Section } from '@/components/ui/Primitives';
import { formatDate } from '@/lib/format';

export function SourcesSection({
  sources,
  datasetVersion,
  publishedAt,
}: {
  sources: Source[];
  datasetVersion: string | null;
  publishedAt: string;
}) {
  return (
    <Section
      id="sumber-data"
      title="Sumber data"
      lead="Publikasi yang dipakai untuk angka di atas."
    >
      <ul className="rounded-2xl border border-border bg-card p-5 sm:p-6 divide-y divide-border py-2!">
        {sources.map((source) => (
          <li key={source.publisher} className="py-3 text-sm">
            <ExternalLink
              href={source.source_url}
              className="rounded-sm font-semibold text-primary underline underline-offset-4 hover:decoration-2 inline-flex min-h-11 items-center"
            >
              {source.publisher} — {source.title}
            </ExternalLink>
            <span className="block text-muted-foreground">
              Periode {source.period.replaceAll(',', ', ')} · diunduh{' '}
              {formatDate(source.downloaded_at)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        Versi dataset <span className="font-mono">{datasetVersion ?? '—'}</span>, dipublikasikan{' '}
        {formatDate(publishedAt)}.
      </p>
    </Section>
  );
}
