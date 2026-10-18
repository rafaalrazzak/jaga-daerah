import { Button } from '@almach/ui/button';

import type { MapViewport } from '@/components/map/use-map-viewport';

type MapCamera = Pick<
  MapViewport,
  'zoomIn' | 'zoomOut' | 'reset' | 'canZoomIn' | 'canZoomOut' | 'atHome'
>;

/** Shared + / − / reset cluster. The same gestures exist on the map itself. */
export function MapZoomControls({ viewport }: { viewport: MapCamera }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        className="min-h-11 min-w-11 px-3"
        aria-label="Perkecil peta"
        disabled={!viewport.canZoomOut}
        onPress={viewport.zoomOut}
      >
        −
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 min-w-11 px-3"
        aria-label="Perbesar peta"
        disabled={!viewport.canZoomIn}
        onPress={viewport.zoomIn}
      >
        +
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 px-3"
        aria-label="Atur ulang pembesaran peta"
        disabled={viewport.atHome}
        onPress={viewport.reset}
      >
        Atur ulang
      </Button>
    </div>
  );
}
