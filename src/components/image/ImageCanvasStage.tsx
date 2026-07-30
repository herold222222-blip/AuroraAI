import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  type CSSProperties,
} from 'react';
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useImageStore } from '../../image/useImageStore';
import { useAppStore } from '../../store/useAppStore';
import {
  findBrushRegionAt,
  mergeStrokeIntoRegions,
  redrawBrushOverlay,
} from '../../image/brushStrokeMerge';
import { ImageOverlayLayer } from './ImageOverlayLayer';
import { ImageRegenerateBar } from './ImageRegenerateBar';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';

function initCrop(
  width: number,
  height: number,
  aspect: number | undefined,
): Crop {
  if (aspect) {
    return centerCrop(
      makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
      width,
      height,
    );
  }
  return centerCrop(
    { unit: '%', width: 85, height: 85 },
    width,
    height,
  );
}

/** Copy stroke pixels before async merge so later paints / canvas resets cannot wipe them. */
function snapshotCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
  if (!source.width || !source.height) return null;
  const snap = document.createElement('canvas');
  snap.width = source.width;
  snap.height = source.height;
  snap.getContext('2d')!.drawImage(source, 0, 0);
  return snap;
}

export function ImageCanvasStage() {
  const currentUrl = useImageStore((s) => s.currentUrl);
  const compareBeforeUrl = useImageStore((s) => s.compareBeforeUrl);
  const showCompare = useImageStore((s) => s.showCompare);
  const tab = useImageStore((s) => s.tab);
  const retouchTool = useImageStore((s) => s.retouchTool);
  const brushSize = useImageStore((s) => s.brushSize);
  const hotspots = useImageStore((s) => s.hotspots);
  const brushRegions = useImageStore((s) => s.brushRegions);
  const placeHotspot = useImageStore((s) => s.placeHotspot);
  const clearHotspots = useImageStore((s) => s.clearHotspots);
  const undoLastHotspot = useImageStore((s) => s.undoLastHotspot);
  const undoLastBrushRegion = useImageStore((s) => s.undoLastBrushRegion);
  const removeBrushRegion = useImageStore((s) => s.removeBrushRegion);
  const setBrushRegions = useImageStore((s) => s.setBrushRegions);
  const setHasMask = useImageStore((s) => s.setHasMask);
  const setRetouchTool = useImageStore((s) => s.setRetouchTool);
  const setShowCompare = useImageStore((s) => s.setShowCompare);
  const cropAspect = useImageStore((s) => s.cropAspect);
  const cropSelection = useImageStore((s) => s.cropSelection);
  const setCropSelection = useImageStore((s) => s.setCropSelection);
  const openDownloadMenu = useImageDownloadMenu();
  const pushToast = useAppStore((s) => s.pushToast);

  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const [compareW, setCompareW] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [viewScale, setViewScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /** Natural size after decode — gates markers; brush uses naturalWidth directly. */
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const painting = useRef(false);
  const strokeDirty = useRef(false);
  const mergeQueue = useRef(Promise.resolve());
  const panning = useRef(false);
  const panLast = useRef({ x: 0, y: 0 });

  const markImageReady = useCallback((img: HTMLImageElement | null) => {
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return;
    }
    setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    setImageSize(null);
    painting.current = false;
    strokeDirty.current = false;
    const stroke = strokeRef.current;
    if (stroke) {
      stroke.getContext('2d')!.clearRect(0, 0, stroke.width, stroke.height);
    }
    // Cached images may skip onLoad; poll readiness after URL swap.
    let cancelled = false;
    let attempts = 0;
    const tryReady = () => {
      if (cancelled) return;
      const img = imgRef.current;
      if (img?.complete && img.naturalWidth > 0) {
        markImageReady(img);
        return;
      }
      if (++attempts > 180) return;
      requestAnimationFrame(tryReady);
    };
    requestAnimationFrame(tryReady);
    return () => {
      cancelled = true;
    };
  }, [currentUrl, markImageReady]);

  const resetView = useCallback(() => {
    setViewScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const viewAltered =
    viewScale > 1.02 || Math.abs(pan.x) > 1 || Math.abs(pan.y) > 1;

  const syncCanvasSize = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      opts?: { preserve?: boolean },
    ): boolean => {
      const img = imgRef.current;
      if (!img || !canvas) return false;
      const w = Math.max(1, Math.round(img.clientWidth));
      const h = Math.max(1, Math.round(img.clientHeight));
      if (canvas.width === w && canvas.height === h) return false;
      let backup: HTMLCanvasElement | null = null;
      if (
        opts?.preserve &&
        canvas.width > 0 &&
        canvas.height > 0 &&
        strokeDirty.current
      ) {
        backup = snapshotCanvas(canvas);
      }
      canvas.width = w;
      canvas.height = h;
      if (backup) {
        canvas.getContext('2d')!.drawImage(backup, 0, 0, w, h);
      }
      return true;
    },
    [],
  );

  const refreshOverlay = useCallback(async () => {
    const mask = maskRef.current;
    if (!mask) return;
    syncCanvasSize(mask);
    // Never wipe an in-progress / pending stroke via bare canvas resize.
    if (painting.current || strokeDirty.current) {
      syncCanvasSize(strokeRef.current, { preserve: true });
    } else {
      syncCanvasSize(strokeRef.current);
    }
    const regions = useImageStore.getState().brushRegions;
    await redrawBrushOverlay(mask, regions);
  }, [syncCanvasSize]);

  useEffect(() => {
    void refreshOverlay();
    const ro = new ResizeObserver(() => {
      void refreshOverlay();
    });
    if (imgRef.current) ro.observe(imgRef.current);
    return () => ro.disconnect();
  }, [currentUrl, refreshOverlay, tab]);

  useEffect(() => {
    void refreshOverlay();
  }, [brushRegions, refreshOverlay]);

  useEffect(() => {
    resetView();
  }, [currentUrl, resetView]);

  useEffect(() => {
    if (retouchTool !== 'eraser') return;
    const { brushRegions: regions, hotspots: pts } = useImageStore.getState();
    if (regions.length) {
      undoLastBrushRegion();
      setRetouchTool('brush');
    } else if (pts.length) {
      undoLastHotspot();
      setRetouchTool('point');
    } else {
      const mask = maskRef.current;
      if (mask) {
        mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
      }
      const stroke = strokeRef.current;
      if (stroke) {
        stroke.getContext('2d')!.clearRect(0, 0, stroke.width, stroke.height);
      }
      setHasMask(false);
      setRetouchTool('select');
    }
  }, [
    retouchTool,
    setHasMask,
    setRetouchTool,
    undoLastBrushRegion,
    undoLastHotspot,
  ]);

  // Retouch: wheel zoom (any tool). Zoomed: middle-button drag pan (any tool).
  useEffect(() => {
    const stage = wrapRef.current;
    if (!stage) return;

    const onWheel = (e: WheelEvent) => {
      const state = useImageStore.getState();
      if (state.tab !== 'retouch') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setViewScale((prev) => {
        const next = Math.min(5, Math.max(1, prev * factor));
        if (next <= 1.001) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        return next;
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      const state = useImageStore.getState();
      if (state.tab !== 'retouch') return;
      // Middle mouse button — pan while zoomed, works for select / brush / point
      if (e.button !== 1) return;
      if (viewScale <= 1.001) return;
      e.preventDefault();
      panning.current = true;
      panLast.current = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-panning');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning.current) return;
      const dx = e.clientX - panLast.current.x;
      const dy = e.clientY - panLast.current.y;
      panLast.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    };

    const endPan = (e: PointerEvent) => {
      if (!panning.current) return;
      panning.current = false;
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      stage.classList.remove('is-panning');
    };

    const onAuxClick = (e: Event) => {
      // Prevent middle-click default (e.g. auto-scroll) while panning zoomed image
      const me = e as globalThis.MouseEvent;
      if (me.button === 1 && viewScale > 1.001) e.preventDefault();
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    stage.addEventListener('auxclick', onAuxClick);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', endPan);
      stage.removeEventListener('pointercancel', endPan);
      stage.removeEventListener('auxclick', onAuxClick);
    };
  }, [viewScale, currentUrl]);

  const comparing =
    Boolean(showCompare && compareBeforeUrl && compareBeforeUrl !== currentUrl);

  useEffect(() => {
    if (!comparing) return;
    const el = compareRef.current;
    if (!el) return;
    const sync = () => setCompareW(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comparing, currentUrl, compareBeforeUrl]);

  useEffect(() => {
    if (tab !== 'crop') return;
    const img = imgRef.current;
    if (!img || !img.complete || !img.width) return;
    setCropSelection(initCrop(img.width, img.height, cropAspect));
  }, [cropAspect, tab, currentUrl, setCropSelection]);

  const toImageCoords = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return null;
    }
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // Visual rect accounts for CSS zoom/pan; map back to layout/canvas space
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    return {
      x: Math.min(natW - 1e-3, Math.max(0, nx * natW)),
      y: Math.min(natH - 1e-3, Math.max(0, ny * natH)),
      lx: nx * img.clientWidth,
      ly: ny * img.clientHeight,
    };
  };

  const paintStrokeAt = (lx: number, ly: number) => {
    const stroke = strokeRef.current;
    const img = imgRef.current;
    // Wait until the current (possibly post-edit) image has real natural size.
    if (!stroke || !img || !img.complete || img.naturalWidth <= 0) return;
    syncCanvasSize(stroke, { preserve: strokeDirty.current });
    const ctx = stroke.getContext('2d')!;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(1, brushSize / 2), 0, Math.PI * 2);
    ctx.fill();
    strokeDirty.current = true;
    clearHotspots();
  };

  const finalizeStroke = useCallback(() => {
    const stroke = strokeRef.current;
    const img = imgRef.current;
    if (
      !stroke ||
      !img ||
      !strokeDirty.current ||
      img.naturalWidth <= 0 ||
      img.naturalHeight <= 0
    ) {
      strokeDirty.current = false;
      return;
    }
    // Snapshot + clear synchronously so async merge cannot race with the next stroke.
    const snap = snapshotCanvas(stroke);
    strokeDirty.current = false;
    stroke.getContext('2d')!.clearRect(0, 0, stroke.width, stroke.height);
    if (!snap) return;

    const natW = img.naturalWidth;
    const natH = img.naturalHeight;

    mergeQueue.current = mergeQueue.current
      .then(async () => {
        const existing = useImageStore.getState().brushRegions;
        const next = await mergeStrokeIntoRegions(snap, existing, natW, natH);
        setBrushRegions(next);
      })
      .catch((err) => {
        console.error('[Aurora] brush stroke merge failed', err);
        pushToast('涂抹区域保存失败，请再试一次', 'error');
      });
  }, [pushToast, setBrushRegions]);

  useEffect(() => {
    const up = () => {
      if (!painting.current) return;
      painting.current = false;
      finalizeStroke();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [finalizeStroke]);

  const onCropImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    imgRef.current = img;
    setCropSelection(initCrop(img.width, img.height, cropAspect));
  };

  if (!currentUrl) return null;

  const onPointClick = (e: MouseEvent) => {
    if (tab !== 'retouch' || retouchTool !== 'point') return;
    if (showCompare) setShowCompare(false);
    const p = toImageCoords(e.clientX, e.clientY);
    if (!p) return;
    const img = imgRef.current;
    const hitRadius = img
      ? Math.max(18, Math.min(img.naturalWidth, img.naturalHeight) * 0.025)
      : 28;
    placeHotspot(p.x, p.y, {
      additive: e.shiftKey,
      hitRadius,
    });
    const mask = maskRef.current;
    if (mask) {
      mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
    }
    const stroke = strokeRef.current;
    if (stroke) {
      stroke.getContext('2d')!.clearRect(0, 0, stroke.width, stroke.height);
    }
    setHasMask(false);
  };

  const onBrushPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (tab !== 'retouch' || retouchTool !== 'brush') return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (showCompare) setShowCompare(false);
    const p = toImageCoords(e.clientX, e.clientY);
    if (!p) return;
    if (e.shiftKey) {
      const img = imgRef.current;
      if (!img || img.naturalWidth <= 0) return;
      void (async () => {
        const hit = await findBrushRegionAt(
          useImageStore.getState().brushRegions,
          p.x,
          p.y,
          img.naturalWidth,
          img.naturalHeight,
        );
        if (hit) removeBrushRegion(hit.id);
      })();
      return;
    }
    painting.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    paintStrokeAt(p.lx, p.ly);
  };

  const onBrushPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (tab !== 'retouch' || retouchTool !== 'brush') {
      setCursor(null);
      return;
    }
    const p = toImageCoords(e.clientX, e.clientY);
    if (!p) {
      setCursor(null);
      return;
    }
    setCursor({ x: p.lx, y: p.ly });
    if (painting.current) paintStrokeAt(p.lx, p.ly);
  };

  const onBrushPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (!painting.current) return;
    painting.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    finalizeStroke();
  };

  const mainImage = (
    <img
      key={currentUrl}
      ref={imgRef}
      src={currentUrl}
      alt="edit"
      className="img-main"
      crossOrigin="anonymous"
      draggable={false}
      onContextMenu={(e) =>
        currentUrl && openDownloadMenu(e, currentUrl, 'aurora-edit')
      }
      onLoad={(e) => {
        markImageReady(e.currentTarget);
        void refreshOverlay();
      }}
      onClick={tab === 'retouch' && retouchTool === 'point' ? onPointClick : undefined}
      onPointerDown={onBrushPointerDown}
      onPointerMove={onBrushPointerMove}
      onPointerUp={onBrushPointerUp}
      onPointerCancel={onBrushPointerUp}
      onPointerLeave={() => {
        if (!painting.current) setCursor(null);
      }}
    />
  );

  return (
    <div
      className={`img-stage${viewAltered ? ' is-zoomed' : ''}`}
      ref={wrapRef}
    >
      {viewAltered && (
        <button
          type="button"
          className="img-view-reset"
          title="还原默认展示大小"
          onClick={resetView}
        >
          还原
        </button>
      )}
      <div className="img-stage-stack">
      <div
        className="img-stage-frame"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${viewScale})`,
          transformOrigin: 'center center',
        }}
      >
        <div
          className={`img-stage-media${tab === 'crop' ? ' is-cropping' : ''}${
            tab === 'retouch' && retouchTool === 'brush' ? ' is-brushing' : ''
          }`}
        >
          {comparing ? (
            <div
              className="img-compare"
              ref={compareRef}
              style={
                {
                  ['--compare-w']: compareW ? `${compareW}px` : undefined,
                } as CSSProperties
              }
            >
              <img
                src={currentUrl}
                alt="after"
                className="img-main img-compare-after"
                onContextMenu={(e) =>
                  currentUrl && openDownloadMenu(e, currentUrl, 'aurora-after')
                }
              />
              <div
                className="img-compare-before"
                style={{ width: `${split}%` }}
              >
                <img
                  src={compareBeforeUrl!}
                  alt="before"
                  className="img-compare-before-img"
                  style={compareW ? { width: compareW } : undefined}
                  onContextMenu={(e) =>
                    compareBeforeUrl &&
                    openDownloadMenu(e, compareBeforeUrl, 'aurora-before')
                  }
                />
              </div>
              <div
                className="img-compare-handle"
                style={{ left: `${split}%` }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const handle = e.currentTarget;
                  const el = handle.parentElement!;
                  handle.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const pct = ((ev.clientX - rect.left) / rect.width) * 100;
                    setSplit(Math.min(100, Math.max(0, pct)));
                  };
                  const up = (ev: PointerEvent) => {
                    handle.releasePointerCapture(ev.pointerId);
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', up);
                    handle.removeEventListener('pointercancel', up);
                  };
                  handle.addEventListener('pointermove', move);
                  handle.addEventListener('pointerup', up);
                  handle.addEventListener('pointercancel', up);
                  move(e.nativeEvent);
                }}
              />
            </div>
          ) : tab === 'crop' ? (
            <ReactCrop
              className="img-react-crop"
              crop={cropSelection}
              aspect={cropAspect}
              keepSelection
              ruleOfThirds
              onChange={(c) => setCropSelection(c)}
            >
              <img
                src={currentUrl}
                alt="crop"
                className="img-main img-crop-target"
                crossOrigin="anonymous"
                draggable={false}
                onLoad={onCropImageLoad}
                onContextMenu={(e) =>
                  currentUrl && openDownloadMenu(e, currentUrl, 'aurora-crop')
                }
              />
            </ReactCrop>
          ) : (
            <>
              {mainImage}
              <ImageOverlayLayer imageSize={imageSize} />
              <canvas
                id="image-mask-canvas"
                ref={maskRef}
                className="img-mask-canvas"
                style={{
                  pointerEvents: 'none',
                  opacity: tab === 'retouch' ? 1 : 0,
                }}
              />
              <canvas
                ref={strokeRef}
                className="img-mask-canvas img-stroke-canvas"
                style={{
                  pointerEvents: 'none',
                  opacity: tab === 'retouch' ? 1 : 0,
                }}
              />
              {imageSize &&
                hotspots.map((hp) => (
                  <span
                    key={hp.id}
                    className="img-hotspot"
                    style={{
                      left: `${(hp.x / imageSize.w) * 100}%`,
                      top: `${(hp.y / imageSize.h) * 100}%`,
                    }}
                  >
                    <span className="img-hotspot-ping" />
                    <span className="img-hotspot-core">{hp.n}</span>
                  </span>
                ))}
              {imageSize &&
                brushRegions.map((br) => (
                  <span
                    key={br.id}
                    className="img-hotspot img-brush-region-num"
                    style={{
                      left: `${(br.cx / imageSize.w) * 100}%`,
                      top: `${(br.cy / imageSize.h) * 100}%`,
                    }}
                  >
                    <span className="img-hotspot-core">{br.n}</span>
                  </span>
                ))}
              {cursor && retouchTool === 'brush' && tab === 'retouch' && (
                <span
                  className="img-brush-cursor"
                  style={{
                    left: cursor.x,
                    top: cursor.y,
                    width: brushSize,
                    height: brushSize,
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
      <ImageRegenerateBar />
      </div>
    </div>
  );
}
