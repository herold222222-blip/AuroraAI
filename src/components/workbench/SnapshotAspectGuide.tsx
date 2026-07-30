import { useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export const SNAPSHOT_ASPECT = 16 / 9;

/**
 * Always span full canvas width; height follows 16:9 and is vertically centered
 * (may extend past top/bottom — parent clips; capture intersects with canvas).
 */
export function fitAspectRect(
  width: number,
  _height: number,
  aspect = SNAPSHOT_ASPECT,
) {
  if (width <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const w = width;
  const h = w / aspect;
  return {
    x: 0,
    y: (_height - h) / 2,
    w,
    h,
  };
}

/**
 * Fixed 16:9 dashed framing guide — horizontally edge-to-edge on the viewport.
 * Snapshot capture crops to this same rectangle via [data-snapshot-frame].
 */
export function SnapshotAspectGuide() {
  const cameraMode = useAppStore((s) => s.cameraMode);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });

  useLayoutEffect(() => {
    if (!cameraMode) return;
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox(fitAspectRect(w, h));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cameraMode]);

  if (!cameraMode) return null;

  return (
    <div className="snapshot-aspect-guide" ref={rootRef} aria-hidden>
      <div
        className="snapshot-aspect-frame"
        data-snapshot-frame
        style={{
          left: 0,
          top: box.y,
          width: '100%',
          height: box.h,
        }}
      >
        <span className="snapshot-aspect-label">16:9 快照取景</span>
      </div>
    </div>
  );
}
