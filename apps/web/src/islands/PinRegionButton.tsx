import type { RegionSummary } from '@jaga-daerah/contracts';
import { useEffect, useState } from 'react';

const STORAGE_KEY_PINNED = 'jagadaerah_pinned_region';

interface PinRegionButtonProps {
  region: RegionSummary;
}

export default function PinRegionButton({ region }: PinRegionButtonProps) {
  const [isPinned, setIsPinned] = useState<boolean>(false);

  useEffect(() => {
    function sync() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PINNED);
        if (saved) {
          const parsed: RegionSummary = JSON.parse(saved);
          setIsPinned(parsed.code === region.code);
        } else {
          setIsPinned(false);
        }
      } catch {
        setIsPinned(false);
      }
    }

    sync();
    window.addEventListener('jagadaerah:pinned-changed', sync);
    return () => window.removeEventListener('jagadaerah:pinned-changed', sync);
  }, [region.code]);

  function togglePin() {
    try {
      if (isPinned) {
        localStorage.removeItem(STORAGE_KEY_PINNED);
        setIsPinned(false);
      } else {
        localStorage.setItem(STORAGE_KEY_PINNED, JSON.stringify(region));
        setIsPinned(true);
      }
      window.dispatchEvent(new Event('jagadaerah:pinned-changed'));
    } catch {
      // Storage unavailable
    }
  }

  return (
    <button
      type="button"
      onClick={togglePin}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-ring ${
        isPinned
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border-border bg-background text-foreground hover:bg-secondary'
      }`}
      aria-pressed={isPinned}
      title={isPinned ? 'Hapus dari Daerah Pantauan Saya' : 'Jadikan sebagai Daerah Pantauan Saya'}
    >
      <svg
        viewBox="0 0 20 20"
        className={`size-4 ${isPinned ? 'text-primary-foreground fill-primary-foreground' : 'text-muted-foreground'}`}
        fill={isPinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={isPinned ? 0 : 1.5}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z"
          clipRule="evenodd"
        />
      </svg>
      <span>{isPinned ? 'Daerah Pantauan Saya' : 'Jadikan Daerah Saya'}</span>
    </button>
  );
}
