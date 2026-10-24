import type { RegionSummary } from '@jaga-daerah/contracts';
import { useEffect, useState } from 'react';

const STORAGE_KEY_PINNED = 'jagadaerah_pinned_region';

export default function PinnedRegionBanner() {
  const [pinned, setPinned] = useState<RegionSummary | null>(null);

  useEffect(() => {
    function loadPinned() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PINNED);
        if (saved) {
          setPinned(JSON.parse(saved));
        } else {
          setPinned(null);
        }
      } catch {
        setPinned(null);
      }
    }

    loadPinned();
    window.addEventListener('jagadaerah:pinned-changed', loadPinned);
    return () => window.removeEventListener('jagadaerah:pinned-changed', loadPinned);
  }, []);

  if (!pinned) return null;

  return (
    <div className="sticky top-16 z-30 border-b border-primary/20 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg viewBox="0 0 20 20" className="size-4 fill-primary" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z"
              clipRule="evenodd"
            />
          </svg>
        </span>

        <p className="min-w-0 flex-1 truncate text-xs sm:text-sm">
          <span className="font-bold text-primary">Pantauan:</span>{' '}
          <span className="font-bold text-foreground">{pinned.name}</span>
          <span className="hidden text-muted-foreground sm:inline">
            {' '}
            · Provinsi {pinned.province.name}
          </span>
        </p>

        <a
          href={`/daerah/${pinned.slug}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Buka Profil
        </a>
        <a
          href={`/bandingkan?daerah1=${pinned.slug}`}
          className="hidden min-h-11 shrink-0 items-center rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring sm:inline-flex"
        >
          Bandingkan
        </a>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY_PINNED);
              setPinned(null);
              window.dispatchEvent(new Event('jagadaerah:pinned-changed'));
            } catch {
              // Ignore
            }
          }}
          title="Hapus dari pantauan"
          aria-label="Hapus dari pantauan"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
