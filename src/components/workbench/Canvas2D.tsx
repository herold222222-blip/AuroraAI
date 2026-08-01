import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import type { Layer } from '../../types';

const HIDDEN_MASK: [number, number, number] = [42, 44, 48];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function darken([r, g, b]: [number, number, number], f: number): [number, number, number] {
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

function lighten([r, g, b]: [number, number, number], a: number): [number, number, number] {
  return [
    Math.min(255, r + a),
    Math.min(255, g + a),
    Math.min(255, b + a),
  ];
}

function setPx(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  data[i * 4] = r;
  data[i * 4 + 1] = g;
  data[i * 4 + 2] = b;
  data[i * 4 + 3] = a;
}

export function Canvas2D() {
  const image = useAppStore((s) => s.image);
  const grid = useAppStore((s) => s.grid);
  const layers = useAppStore((s) => s.layers);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const selectLayer = useAppStore((s) => s.selectLayer);
  const openDownloadMenu = useImageDownloadMenu();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedLayers = layers.filter((l) => selectedSet.has(l.id));

  const keyMap = useMemo(() => {
    const m = new Map<number, Layer>();
    layers.forEach((l) => m.set(l.key, l));
    return m;
  }, [layers]);

  const hoveredKey = useMemo(() => {
    if (!hoveredId) return -1;
    return layers.find((l) => l.id === hoveredId)?.key ?? -1;
  }, [hoveredId, layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const { width, height, cells } = grid;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(width, height);
    const data = img.data;
    const hasSel = selectedSet.size > 0;
    const selectedKeys = new Set(selectedLayers.map((l) => l.key));
    const keyAt = (x: number, y: number) => cells[y * width + x];

    // base fill: visible layers show segmentation color; hidden layers show dark mask
    for (let i = 0; i < cells.length; i++) {
      const layer = keyMap.get(cells[i]);
      let r = 0,
        g = 0,
        b = 0,
        a = 0;

      if (layer) {
        if (!layer.visible) {
          [r, g, b] = HIDDEN_MASK;
          a = 210;
        } else {
          [r, g, b] = hexToRgb(layer.color);
          const isSel = selectedSet.has(layer.id);
          const isSky = layer.kind === 'sky';
          if (isSel) a = 165;
          else if (hasSel) a = isSky ? 40 : 70;
          else a = isSky ? 55 : 110;
        }
      }

      setPx(data, i, r, g, b, a);
    }

    // hover: darken + raised bevel on the hovered visible region
    if (hoveredKey >= 0) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const k = keyAt(x, y);
          if (k !== hoveredKey) continue;
          const layer = keyMap.get(k);
          if (!layer?.visible) continue;

          const i = y * width + x;
          let r = data[i * 4];
          let g = data[i * 4 + 1];
          let b = data[i * 4 + 2];
          [r, g, b] = darken([r, g, b], 0.78);
          setPx(data, i, r, g, b, Math.min(255, data[i * 4 + 3] + 40));

          const topOut = y === 0 || keyAt(x, y - 1) !== hoveredKey;
          const leftOut = x === 0 || keyAt(x - 1, y) !== hoveredKey;
          const botOut = y === height - 1 || keyAt(x, y + 1) !== hoveredKey;
          const rightOut = x === width - 1 || keyAt(x + 1, y) !== hoveredKey;

          if (topOut || leftOut) {
            const [hr, hg, hb] = lighten([r, g, b], 55);
            setPx(data, i, hr, hg, hb, 255);
          }
          if (botOut || rightOut) {
            const [sr, sg, sb] = darken([r, g, b], 0.62);
            setPx(data, i, sr, sg, sb, 255);
          }
        }
      }
    }

    // crisp white outline on selected regions (2px: outer glow + inner edge)
    if (selectedKeys.size > 0) {
      const inSel = (x: number, y: number) => selectedKeys.has(keyAt(x, y));

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!inSel(x, y)) continue;

          const onEdge =
            x === 0 ||
            y === 0 ||
            x === width - 1 ||
            y === height - 1 ||
            !inSel(x - 1, y) ||
            !inSel(x + 1, y) ||
            !inSel(x, y - 1) ||
            !inSel(x, y + 1);

          if (onEdge) setPx(data, y * width + x, 255, 255, 255, 255);
        }
      }

      // outer halo for clearer contrast against busy imagery
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (inSel(x, y)) continue;
          const touchesSel =
            (x > 0 && inSel(x - 1, y)) ||
            (x < width - 1 && inSel(x + 1, y)) ||
            (y > 0 && inSel(x, y - 1)) ||
            (y < height - 1 && inSel(x, y + 1));
          if (touchesSel) setPx(data, y * width + x, 255, 255, 255, 200);
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  }, [grid, keyMap, selectedSet, selectedLayers, layers, hoveredKey]);

  const pickLayer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return null;
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - rect.left) / rect.width) * grid.width);
    const gy = Math.floor(((e.clientY - rect.top) / rect.height) * grid.height);
    if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) return null;
    const key = grid.cells[gy * grid.width + gx];
    return layers.find((l) => l.key === key) ?? null;
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const layer = pickLayer(e);
    if (!layer || layer.kind === 'sky') {
      if (!e.shiftKey) selectLayer(null);
      return;
    }
    if (e.shiftKey) {
      selectLayer(layer.id, true);
    } else if (selectedIds.length === 1 && selectedIds[0] === layer.id) {
      selectLayer(null);
    } else {
      selectLayer(layer.id);
    }
  };

  const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const layer = pickLayer(e);
    if (layer && layer.visible && layer.kind !== 'sky') {
      setHoveredId(layer.id);
    } else {
      setHoveredId(null);
    }
  };

  return (
    <section className="canvas-area">
      <div className="canvas-toolbar">
        <div className="canvas-status">
          <span
            className={`status-dot${selectedLayers.length ? ' on' : ''}`}
            aria-hidden
          />
          <span className="canvas-status-text">
            {selectedLayers.length === 0
              ? '请在下方画布中点选色块以定义图层（按住 Shift 可多选）'
              : selectedLayers.length === 1
                ? `已选择地物图斑：${selectedLayers[0].name}`
                : `已选择 ${selectedLayers.length} 个图层`}
          </span>
        </div>
      </div>

      <div className="canvas-stage">
        {image && grid ? (
          <div className="canvas-frame">
            <img
              src={image.url}
              alt="意向图底图"
              className="canvas-base"
              onContextMenu={(e) =>
                openDownloadMenu(e, image.url, image.name || 'aurora-base')
              }
            />
            <canvas
              ref={canvasRef}
              className="canvas-mask"
              onClick={onCanvasClick}
              onMouseMove={onCanvasMove}
              onMouseLeave={() => setHoveredId(null)}
            />
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="canvas-empty-icon">🖼</div>
            <div>画布已重置，请在左侧上传新图片以重新分析场景</div>
          </div>
        )}
      </div>
    </section>
  );
}
