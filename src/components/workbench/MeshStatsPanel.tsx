import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { buildMassing } from './buildMassing';

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function MeshStatsPanel() {
  const grid = useAppStore((s) => s.grid);
  const layers = useAppStore((s) => s.layers);
  const faceQuality = useAppStore((s) => s.appliedFaceQuality);

  const stats = useMemo(() => {
    if (!grid || layers.length === 0) {
      return { topology: '—', faces: 0, vertices: 0 };
    }

    const visible = layers.filter((l) => l.visible && l.kind !== 'sky');
    const topoSet = new Set(visible.map((l) => l.topology ?? 'triangle'));
    let topology = '混合';
    if (topoSet.size === 1) {
      topology = topoSet.has('triangle') ? '三角面' : '四边面';
    } else if (topoSet.size === 0) {
      topology = '—';
    }

    const meshes = buildMassing(grid, layers, faceQuality ?? 'auto');
    let faces = 0;
    let vertices = 0;
    for (const { layer, positions } of meshes) {
      // Non-indexed triangles: 3 floats/vert, 9 floats/triangle.
      // Quad topology emits 2 triangles per logical face.
      vertices += positions.length / 3;
      const tris = positions.length / 9;
      faces += (layer.topology ?? 'triangle') === 'quad' ? tris / 2 : tris;
    }

    return {
      topology,
      faces: Math.round(faces),
      vertices: Math.round(vertices),
    };
  }, [grid, layers, faceQuality]);

  if (!grid) return null;

  return (
    <div className="mesh-stats" aria-label="模型数据统计">
      <div className="mesh-stats-row">
        <span className="mesh-stats-label">拓扑</span>
        <span className="mesh-stats-value">{stats.topology}</span>
      </div>
      <div className="mesh-stats-row">
        <span className="mesh-stats-label">面数</span>
        <span className="mesh-stats-value">{formatCount(stats.faces)}</span>
      </div>
      <div className="mesh-stats-row">
        <span className="mesh-stats-label">顶点数</span>
        <span className="mesh-stats-value">{formatCount(stats.vertices)}</span>
      </div>
    </div>
  );
}
