/** SVG viewBox maths for drag, wheel, and pinch. The React hook applies it without rerendering paths. */

export type ViewBox = [number, number, number, number];

/** Slightly wider than the home extent, so the whole map can sit with a margin. */
export const MIN_ZOOM = 0.75;
/** Far enough to read a kabupaten outline; past this the strokes stop adding detail. */
export const MAX_ZOOM = 12;

/**
 * Scale around an anchor so that point stays under the cursor.
 * `factor` above 1 zooms in.
 */
export function zoomAt(view: ViewBox, factor: number, anchorX: number, anchorY: number): ViewBox {
  const [x, y, width, height] = view;
  const nextWidth = width / factor;
  const nextHeight = height / factor;
  return [
    anchorX - ((anchorX - x) / width) * nextWidth,
    anchorY - ((anchorY - y) / height) * nextHeight,
    nextWidth,
    nextHeight,
  ];
}

/**
 * Keep the centre of the view inside the home extent, and the zoom between the limits.
 * The view's aspect ratio is preserved.
 */
export function clampView(view: ViewBox, home: ViewBox): ViewBox {
  const [x, y, width, height] = view;
  const [hx, hy, homeWidth, homeHeight] = home;
  const aspect = width / height;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, homeWidth / width));
  const nextWidth = homeWidth / zoom;
  const nextHeight = nextWidth / aspect;
  const cx = Math.min(Math.max(x + width / 2, hx), hx + homeWidth);
  const cy = Math.min(Math.max(y + height / 2, hy), hy + homeHeight);
  return [cx - nextWidth / 2, cy - nextHeight / 2, nextWidth, nextHeight];
}

/**
 * Client pixels to SVG user units, accounting for `preserveAspectRatio="xMidYMid meet"`
 * letterboxing. Without this, wheel zoom aims at the element box instead of the map.
 */
export function clientToUser(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  view: ViewBox,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const width = view[2];
  const height = view[3];
  const viewAspect = width / height;
  const boxAspect = rect.width / Math.max(rect.height, 1);
  let contentWidth = rect.width;
  let contentHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (boxAspect > viewAspect) {
    contentWidth = rect.height * viewAspect;
    offsetX = (rect.width - contentWidth) / 2;
  } else {
    contentHeight = rect.width / viewAspect;
    offsetY = (rect.height - contentHeight) / 2;
  }
  const px = (clientX - rect.left - offsetX) / Math.max(contentWidth, 1);
  const py = (clientY - rect.top - offsetY) / Math.max(contentHeight, 1);
  return { x: view[0] + px * width, y: view[1] + py * height };
}
