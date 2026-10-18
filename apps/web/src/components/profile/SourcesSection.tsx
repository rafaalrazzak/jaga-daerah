import type { Source } from '@jaga-daerah/contracts';

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
    <section aria-labelledby="sumber-data" className="space-y-3">
      <h2 id="sumber-data" className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
        Sumber data
      </h2>
      <ul className="space-y-3">
        {sources.map((source) => (
          <li key={source.publisher} className="text-sm">
            <a
              href={source.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
            >
              {source.publisher} — {source.title}
              <span className="sr-only"> (membuka tab baru)</span>
            </a>
            <span className="block text-muted-foreground">
              Periode {source.period.replaceAll(',', ', ')} · diunduh{' '}
              {formatDate(source.downloaded_at)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Versi dataset <span className="font-mono">{datasetVersion ?? '—'}</span>, dipublikasikan{' '}
        {formatDate(publishedAt)}.
      </p>
    </section>
  );
}
