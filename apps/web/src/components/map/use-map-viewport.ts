import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_ZOOM, MIN_ZOOM, clampView, clientToUser, zoomAt } from '@/lib/map-viewport';
import type { ViewBox } from '@/lib/map-viewport';

const BUTTON_FACTOR = 1.5;
const KEY_PAN = 0.18;
const DRAG_PX = 5;
const ZOOM_MS = 260;

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function formatView(view: ViewBox): string {
  return view.map((value) => String(Math.round(value * 100) / 100)).join(' ');
}

function limitsFor(view: ViewBox, home: ViewBox) {
  const zoom = home[2] / view[2];
  const atHome =
    Math.abs(zoom - 1) < 0.02 &&
    Math.abs(view[0] + view[2] / 2 - (home[0] + home[2] / 2)) < 0.8 &&
    Math.abs(view[1] + view[3] / 2 - (home[1] + home[3] / 2)) < 0.8;
  return {
    canZoomIn: zoom < MAX_ZOOM - 0.05,
    canZoomOut: zoom > MIN_ZOOM + 0.02,
    atHome,
  };
}

export interface MapViewport {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  atHome: boolean;
  /** True once after a drag, so the click that follows does not open a region. */
  takeSuppressedClick: () => boolean;
}

/**
 * Google-Maps-style camera for a pre-projected SVG: drag to pan, wheel and pinch to zoom
 * toward the pointer, buttons and arrow keys for the same motions. Paths are not rerendered;
 * only the viewBox attribute moves.
 */
export function useMapViewport(
  home: ViewBox,
  svg: SVGSVGElement | null,
  keys: HTMLElement | null = null,
): MapViewport {
  const homeKey = home.join(' ');
  const homeRef = useRef(home);
  const nodeRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef<ViewBox>(home);
  const frameRef = useRef(0);
  const limitTimer = useRef(0);
  const suppressRef = useRef(false);
  const [limits, setLimits] = useState(() => limitsFor(home, home));

  const publish = useCallback((view: ViewBox = viewRef.current) => {
    setLimits(limitsFor(view, homeRef.current));
  }, []);

  const write = useCallback((next: ViewBox, exact?: string) => {
    const clamped = clampView(next, homeRef.current);
    viewRef.current = clamped;
    nodeRef.current?.setAttribute('viewBox', exact ?? formatView(clamped));
  }, []);

  const cancelMotion = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
  }, []);

  const animateTo = useCallback(
    (target: ViewBox, exact?: string) => {
      cancelMotion();
      const from = viewRef.current;
      const duration = reducedMotion() ? 0 : ZOOM_MS;
      const start = performance.now();
      const step = (now: number) => {
        const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** 3;
        if (progress >= 1) {
          write(target, exact);
          publish(target);
          return;
        }
        write([
          from[0] + (target[0] - from[0]) * eased,
          from[1] + (target[1] - from[1]) * eased,
          from[2] + (target[2] - from[2]) * eased,
          from[3] + (target[3] - from[3]) * eased,
        ]);
        frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    },
    [cancelMotion, publish, write],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const current = viewRef.current;
      const target = clampView(
        zoomAt(current, factor, current[0] + current[2] / 2, current[1] + current[3] / 2),
        homeRef.current,
      );
      publish(target);
      animateTo(target);
    },
    [animateTo, publish],
  );

  const reset = useCallback(() => {
    const target = homeRef.current;
    publish(target);
    animateTo(target, target.join(' '));
  }, [animateTo, publish]);

  useEffect(() => {
    nodeRef.current = svg;
    homeRef.current = home;
    if (svg === null) return;
    viewRef.current = home;
    svg.setAttribute('viewBox', homeKey);
    publish(home);

    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let captured = false;
    let originX = 0;
    let originY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityX = 0;
    let velocityY = 0;
    let pinchDist = 0;
    let pinchX = 0;
    let pinchY = 0;

    const fitted = () => {
      const rect = svg.getBoundingClientRect();
      const view = viewRef.current;
      const viewAspect = view[2] / view[3];
      const boxAspect = rect.width / Math.max(rect.height, 1);
      const contentWidth = boxAspect > viewAspect ? rect.height * viewAspect : rect.width;
      const contentHeight = boxAspect > viewAspect ? rect.height : rect.width / viewAspect;
      return { contentWidth: Math.max(contentWidth, 1), contentHeight: Math.max(contentHeight, 1) };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelMotion();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.00135);
      const anchor = clientToUser(
        svg.getBoundingClientRect(),
        viewRef.current,
        event.clientX,
        event.clientY,
      );
      write(zoomAt(viewRef.current, factor, anchor.x, anchor.y));
      window.clearTimeout(limitTimer.current);
      limitTimer.current = window.setTimeout(() => publish(), 120);
    };

    const coast = () => {
      if (reducedMotion()) {
        publish();
        return;
      }
      let previous = performance.now();
      const step = (now: number) => {
        const dt = Math.min(32, now - previous);
        previous = now;
        const decay = Math.exp(-dt / 150);
        velocityX *= decay;
        velocityY *= decay;
        if (Math.hypot(velocityX, velocityY) < 0.015) {
          publish();
          return;
        }
        const { contentWidth, contentHeight } = fitted();
        const view = viewRef.current;
        write([
          view[0] - (velocityX * dt * view[2]) / contentWidth,
          view[1] - (velocityY * dt * view[3]) / contentHeight,
          view[2],
          view[3],
        ]);
        frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      cancelMotion();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragging = false;
      captured = false;
      originX = event.clientX;
      originY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
      lastTime = event.timeStamp;
      velocityX = 0;
      velocityY = 0;
      if (pointers.size === 2) {
        const [first, second] = [...pointers.values()];
        if (first !== undefined && second !== undefined) {
          pinchDist = Math.hypot(first.x - second.x, first.y - second.y);
          pinchX = (first.x + second.x) / 2;
          pinchY = (first.y + second.y) / 2;
        }
      }
    };

    const onMove = (event: PointerEvent) => {
      const point = pointers.get(event.pointerId);
      if (point === undefined) return;
      point.x = event.clientX;
      point.y = event.clientY;

      if (pointers.size >= 2 && pinchDist > 0) {
        const [first, second] = [...pointers.values()];
        if (first === undefined || second === undefined) return;
        const dist = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
        const midX = (first.x + second.x) / 2;
        const midY = (first.y + second.y) / 2;
        const anchor = clientToUser(svg.getBoundingClientRect(), viewRef.current, pinchX, pinchY);
        write(zoomAt(viewRef.current, dist / pinchDist, anchor.x, anchor.y));
        const { contentWidth, contentHeight } = fitted();
        const view = viewRef.current;
        write([
          view[0] - ((midX - pinchX) * view[2]) / contentWidth,
          view[1] - ((midY - pinchY) * view[3]) / contentHeight,
          view[2],
          view[3],
        ]);
        pinchDist = dist;
        pinchX = midX;
        pinchY = midY;
        dragging = true;
        return;
      }

      if (Math.hypot(event.clientX - originX, event.clientY - originY) < DRAG_PX) return;
      if (!captured) {
        dragging = true;
        captured = true;
        svg.setPointerCapture(event.pointerId);
        svg.classList.add('is-panning');
      }
      const dt = Math.max(8, event.timeStamp - lastTime);
      velocityX = (event.clientX - lastX) / dt;
      velocityY = (event.clientY - lastY) / dt;
      const { contentWidth, contentHeight } = fitted();
      const view = viewRef.current;
      write([
        view[0] - ((event.clientX - lastX) * view[2]) / contentWidth,
        view[1] - ((event.clientY - lastY) * view[3]) / contentHeight,
        view[2],
        view[3],
      ]);
      lastX = event.clientX;
      lastY = event.clientY;
      lastTime = event.timeStamp;
    };

    const finishPointer = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      if (pointers.size > 0) return;
      svg.classList.remove('is-panning');
      if (dragging) {
        suppressRef.current = true;
        window.setTimeout(() => {
          suppressRef.current = false;
        }, 0);
        coast();
      }
      dragging = false;
      captured = false;
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', finishPointer);
    svg.addEventListener('pointercancel', finishPointer);
    return () => {
      cancelMotion();
      window.clearTimeout(limitTimer.current);
      svg.classList.remove('is-panning');
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', finishPointer);
      svg.removeEventListener('pointercancel', finishPointer);
    };
  }, [cancelMotion, home, homeKey, publish, svg, write]);

  useEffect(() => {
    const node = keys ?? svg;
    if (node === null) return;
    const onKey = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const view = viewRef.current;
      const pan = (x: number, y: number) => {
        event.preventDefault();
        const target = clampView(
          [view[0] + x * view[2], view[1] + y * view[3], view[2], view[3]],
          homeRef.current,
        );
        publish(target);
        animateTo(target);
      };
      if (event.key === 'ArrowLeft') pan(-KEY_PAN, 0);
      else if (event.key === 'ArrowRight') pan(KEY_PAN, 0);
      else if (event.key === 'ArrowUp') pan(0, -KEY_PAN);
      else if (event.key === 'ArrowDown') pan(0, KEY_PAN);
      else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(BUTTON_FACTOR);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / BUTTON_FACTOR);
      } else if (event.key === 'Home') {
        event.preventDefault();
        reset();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [animateTo, keys, publish, reset, svg, zoomBy]);

  const takeSuppressedClick = useCallback(() => {
    if (!suppressRef.current) return false;
    suppressRef.current = false;
    return true;
  }, []);

  return {
    zoomIn: () => zoomBy(BUTTON_FACTOR),
    zoomOut: () => zoomBy(1 / BUTTON_FACTOR),
    reset,
    canZoomIn: limits.canZoomIn,
    canZoomOut: limits.canZoomOut,
    atHome: limits.atHome,
    takeSuppressedClick,
  };
}
