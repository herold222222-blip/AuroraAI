import { useEffect, useRef, useState } from 'react';
import { useImageStore } from '../../image/useImageStore';
import { ConfirmDialog } from '../common/ConfirmDialog';

/**
 * Draggable / scalable cutout stickers on the image stage.
 * Coordinates are natural-image pixels, positioned as % of the media box.
 */
export function ImageOverlayLayer({
  imageSize,
}: {
  imageSize: { w: number; h: number } | null;
}) {
  const overlays = useImageStore((s) => s.overlays);
  const selectedOverlayId = useImageStore((s) => s.selectedOverlayId);
  const selectOverlay = useImageStore((s) => s.selectOverlay);
  const updateOverlay = useImageStore((s) => s.updateOverlay);
  const removeOverlay = useImageStore((s) => s.removeOverlay);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'scale';
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    ow: number;
    oh: number;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      const id = useImageStore.getState().selectedOverlayId;
      if (id) {
        e.preventDefault();
        setConfirmRemoveId(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!imageSize) return null;

  return (
    <>
      {overlays.length > 0 && (
        <div className="img-overlay-layer">
          {overlays.map((o) => {
            const selected = o.id === selectedOverlayId;
            const left = (o.x / imageSize.w) * 100;
            const top = (o.y / imageSize.h) * 100;
            const widthPct = (o.w / imageSize.w) * 100;
            const heightPct = (o.h / imageSize.h) * 100;
            return (
              <div
                key={o.id}
                className={`img-overlay-item${selected ? ' is-selected' : ''}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectOverlay(o.id);
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  drag.current = {
                    id: o.id,
                    mode: 'move',
                    startX: e.clientX,
                    startY: e.clientY,
                    ox: o.x,
                    oy: o.y,
                    ow: o.w,
                    oh: o.h,
                  };
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.id !== o.id || d.mode !== 'move') return;
                  const media = e.currentTarget.parentElement;
                  if (!media) return;
                  const rect = media.getBoundingClientRect();
                  const dx = ((e.clientX - d.startX) / rect.width) * imageSize.w;
                  const dy = ((e.clientY - d.startY) / rect.height) * imageSize.h;
                  updateOverlay(o.id, {
                    x: Math.min(imageSize.w, Math.max(0, d.ox + dx)),
                    y: Math.min(imageSize.h, Math.max(0, d.oy + dy)),
                  });
                }}
                onPointerUp={(e) => {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  drag.current = null;
                }}
                onWheel={(e) => {
                  if (!selected) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
                  const aspect = o.w / Math.max(1, o.h);
                  const w = Math.min(
                    imageSize.w * 0.9,
                    Math.max(24, o.w * factor),
                  );
                  updateOverlay(o.id, { w, h: w / aspect });
                }}
              >
                <img src={o.url} alt={o.label} draggable={false} />
                {selected && (
                  <span
                    className="img-overlay-handle"
                    title="拖动缩放"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const el = e.currentTarget;
                      el.setPointerCapture(e.pointerId);
                      drag.current = {
                        id: o.id,
                        mode: 'scale',
                        startX: e.clientX,
                        startY: e.clientY,
                        ox: o.x,
                        oy: o.y,
                        ow: o.w,
                        oh: o.h,
                      };
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current;
                      if (!d || d.id !== o.id || d.mode !== 'scale') return;
                      const media = e.currentTarget.parentElement?.parentElement;
                      if (!media) return;
                      const rect = media.getBoundingClientRect();
                      const dx =
                        ((e.clientX - d.startX) / rect.width) * imageSize.w;
                      const aspect = d.ow / Math.max(1, d.oh);
                      const w = Math.min(
                        imageSize.w * 0.9,
                        Math.max(24, d.ow + dx * 2),
                      );
                      updateOverlay(o.id, { w, h: w / aspect });
                    }}
                    onPointerUp={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      drag.current = null;
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmRemoveId && (
        <ConfirmDialog
          message="确定删除该素材图层？"
          onCancel={() => setConfirmRemoveId(null)}
          onConfirm={() => {
            removeOverlay(confirmRemoveId);
            setConfirmRemoveId(null);
          }}
        />
      )}
    </>
  );
}
