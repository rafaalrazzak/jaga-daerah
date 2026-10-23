import { cn } from '@almach/utils';
import type { RegionProfile, Source } from '@jaga-daerah/contracts';
import { useState } from 'react';

import { ExternalLink, Section } from '@/components/ui/Primitives';
import { linkButton } from '@/components/ui/styles';
import { formatDate } from '@/lib/format';
import {
  buildCitation,
  buildRegionCsv,
  buildRegionJson,
  downloadTextFile,
  regionExportFilename,
} from '@/lib/region-data';

function DownloadPanel({
  profile,
  regionSlug,
  datasetVersion,
}: {
  profile: RegionProfile;
  regionSlug: string;
  datasetVersion: string | null;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [citation, setCitation] = useState<string | null>(null);
  const year = profile.year;
  const pageUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/daerah/${regionSlug}?tahun=${year}`;

  function download(format: 'json' | 'csv') {
    const content =
      format === 'json'
        ? buildRegionJson(profile, {
            datasetVersion,
            downloadedFrom: pageUrl,
            exportedAt: new Date().toISOString(),
          })
        : buildRegionCsv(profile);
    downloadTextFile(
      regionExportFilename(regionSlug, year, format),
      format === 'json' ? 'application/json' : 'text/csv',
      content,
    );
    setStatus(`Berkas ${format.toUpperCase()} diunduh.`);
  }

  async function copyCitation() {
    const text = buildCitation(profile, pageUrl, new Date());
    setCitation(text);
    try {
      if (navigator.clipboard === undefined) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('Kutipan disalin ke papan klip.');
    } catch {
      setStatus('Tidak bisa menyalin otomatis. Pilih teks kutipan di bawah lalu salin.');
    }
  }

  return (
    <div
      id="unduh-data"
      className="scroll-mt-32 rounded-2xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="font-bold tracking-tight">Unduh &amp; kutip data</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            JSON memuat seluruh angka profil beserta sumber, versi dataset, dan tautan halaman. CSV
            memuat angka anggaran, belanja, dana SDA, bencana, dan sumber dalam satu tabel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => download('json')}
            className={cn(linkButton('outline', true), 'cursor-pointer')}
          >
            Unduh JSON
          </button>
          <button
            type="button"
            onClick={() => download('csv')}
            className={cn(linkButton('outline', true), 'cursor-pointer')}
          >
            Unduh CSV
          </button>
          <button
            type="button"
            onClick={() => void copyCitation()}
            className={cn(linkButton('primary', true), 'cursor-pointer')}
          >
            Salin kutipan
          </button>
        </div>
      </div>
      {citation === null ? null : (
        <p className="mt-3 rounded-xl bg-secondary p-3 text-xs leading-relaxed select-all">
          {citation}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
        {status}
      </p>
    </div>
  );
}

export function SourcesSection({
  sources,
  datasetVersion,
  publishedAt,
  profile,
  regionSlug,
}: {
  sources: Source[];
  datasetVersion: string | null;
  publishedAt: string;
  profile: RegionProfile;
  regionSlug: string;
}) {
  return (
    <Section
      id="sumber-data"
      title="Sumber data"
      lead="Publikasi yang dipakai untuk angka di atas."
    >
      <DownloadPanel profile={profile} regionSlug={regionSlug} datasetVersion={datasetVersion} />
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
