import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { matchesFilter, type LayerFilter } from '../../store/useAppStore';
import type { Dimension, TopologyType } from '../../types';
import { InlineRename } from '../common/InlineRename';
import { Check } from '../common/Controls';
import { MergeModal } from './MergeModal';
import { SplitModal } from './SplitModal';

const FILTERS: { key: LayerFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: '3D', label: '3D' },
  { key: '2D', label: '2D' },
  { key: 'hidden', label: '隐藏' },
];

export function LayerManager() {
  const layers = useAppStore((s) => s.layers);
  const filter = useAppStore((s) => s.layerFilter);
  const setFilter = useAppStore((s) => s.setLayerFilter);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const selectLayer = useAppStore((s) => s.selectLayer);
  const selectAllLayers = useAppStore((s) => s.selectAllLayers);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const toggleVisibility = useAppStore((s) => s.toggleVisibility);
  const setDimension = useAppStore((s) => s.setDimension);
  const setTopology = useAppStore((s) => s.setTopology);
  const renameLayer = useAppStore((s) => s.renameLayer);
  const build3D = useAppStore((s) => s.build3D);
  const pushToast = useAppStore((s) => s.pushToast);

  const [modal, setModal] = useState<
    { type: 'merge' } | { type: 'split'; id: string } | null
  >(null);

  const filtered = layers.filter((l) => matchesFilter(l, filter));
  const selectedSet = new Set(selectedIds);
  const countFor = (f: LayerFilter) =>
    layers.filter((l) => matchesFilter(l, f)).length;

  const allSelected =
    filtered.length > 0 && filtered.every((l) => selectedSet.has(l.id));

  const onCardClick = (id: string, shift: boolean) => {
    if (shift) selectLayer(id, true);
    else if (selectedIds.length === 1 && selectedIds[0] === id)
      selectLayer(null);
    else selectLayer(id);
  };

  const flip = (id: string, current: Dimension) =>
    setDimension(id, current === '2D' ? '3D' : '2D');

  const flipTopology = (id: string, current: TopologyType) =>
    setTopology(id, current === 'quad' ? 'triangle' : 'quad');

  const topoLabel = (t: TopologyType) => (t === 'quad' ? '四边面' : '三角面');

  const openMerge = () => {
    if (selectedIds.length < 2) {
      pushToast('请勾选至少 2 个图层再合并', 'info');
      return;
    }
    setModal({ type: 'merge' });
  };

  const openSplit = () => {
    if (selectedIds.length !== 1) {
      pushToast('请仅选择 1 个图层进行拆分', 'info');
      return;
    }
    setModal({ type: 'split', id: selectedIds[0] });
  };

  return (
    <aside className="panel right">
      <div className="panel-scroll">
        <h4 style={{ marginBottom: 10 }}>图层架构管理器</h4>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? 'active' : ''}
              onClick={() => setFilter(f.key)}
            >
              {f.label}（{countFor(f.key)}）
            </button>
          ))}
        </div>

        <div className="layer-actions">
          <button
            className="btn soft sm"
            disabled={filtered.length === 0}
            onClick={() => (allSelected ? clearSelection() : selectAllLayers())}
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button
            className="btn soft sm"
            disabled={selectedIds.length < 2}
            onClick={openMerge}
          >
            <span className="btn-ico" aria-hidden>
              🔗
            </span>
            合并
            {selectedIds.length > 0 ? `（${selectedIds.length}）` : ''}
          </button>
          <button
            className="btn soft sm"
            disabled={selectedIds.length !== 1}
            onClick={openSplit}
          >
            <span className="btn-ico" aria-hidden>
              ✂
            </span>
            拆分
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">该分类下暂无图层</div>
        ) : (
          filtered.map((l) => (
            <div
              key={l.id}
              className={`layer-card${selectedSet.has(l.id) ? ' selected' : ''}${
                l.visible ? '' : ' hidden'
              }`}
              onClick={(e) => onCardClick(l.id, e.shiftKey)}
            >
              <Check
                checked={selectedSet.has(l.id)}
                onChange={() => selectLayer(l.id, true)}
              />
              <button
                className="layer-eye"
                title={l.visible ? '隐藏图层（不生成三维模型）' : '显示图层'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVisibility(l.id);
                }}
              >
                {l.visible ? '👁' : '—'}
              </button>
              <span className="layer-swatch" style={{ background: l.color }} />
              <div className="layer-main">
                <InlineRename
                  className="layer-name"
                  value={l.name}
                  onChange={(name) => renameLayer(l.id, name)}
                />
                <div className="layer-tags">
                  <button
                    className={`dim-tag clickable ${l.dimension === '2D' ? 'd2' : 'd3'}`}
                    title="点击切换 2D / 3D 属性"
                    onClick={(e) => {
                      e.stopPropagation();
                      flip(l.id, l.dimension);
                    }}
                  >
                    {l.dimension}
                  </button>
                  <button
                    className={`topo-tag clickable ${(l.topology ?? 'triangle') === 'quad' ? 'quad' : 'tri'}`}
                    title="点击切换拓扑结构（四边面 / 三角面）"
                    onClick={(e) => {
                      e.stopPropagation();
                      flipTopology(l.id, l.topology ?? 'triangle');
                    }}
                  >
                    {topoLabel(l.topology ?? 'triangle')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="panel-footer">
        <button
          className="btn holo block"
          disabled={layers.length === 0}
          onClick={() => build3D()}
        >
          生成 3D 模型 →
        </button>
      </div>

      {modal?.type === 'merge' && (
        <MergeModal sourceIds={selectedIds} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'split' && (
        <SplitModal sourceId={modal.id} onClose={() => setModal(null)} />
      )}
    </aside>
  );
}
