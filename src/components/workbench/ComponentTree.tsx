import { matchesFilter, useAppStore } from '../../store/useAppStore';
import { Check } from '../common/Controls';
import { InlineRename } from '../common/InlineRename';

interface ComponentTreeProps {
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
  onMerge: () => void;
  /** when embedded in RightSidebar3D, omit outer panel chrome */
  embedded?: boolean;
  /** hide merge button (e.g. when rendered in section footer) */
  hideMerge?: boolean;
}

export function ComponentTree({
  checkedIds,
  onToggleCheck,
  onMerge,
  embedded,
  hideMerge,
}: ComponentTreeProps) {
  const layers = useAppStore((s) => s.layers);
  const filter = useAppStore((s) => s.layerFilter);
  const setFilter = useAppStore((s) => s.setLayerFilter);
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const selectLayer = useAppStore((s) => s.selectLayer);
  const toggleVisibility = useAppStore((s) => s.toggleVisibility);
  const renameLayer = useAppStore((s) => s.renameLayer);

  const filtered = layers.filter((l) => matchesFilter(l, filter));

  const isSelected = (id: string) =>
    selectedIds.includes(id) || selectedId === id;

  const list = (
    <>
      {filtered.length === 0 ? (
        <div className="empty">该分类下暂无组件</div>
      ) : (
        filtered.map((l) => (
          <div
            key={l.id}
            className={`layer-card${isSelected(l.id) ? ' selected' : ''}${
              l.visible ? '' : ' hidden'
            }`}
            onClick={(e) => selectLayer(l.id, e.shiftKey)}
          >
            <Check
              checked={checkedIds.has(l.id)}
              onChange={() => onToggleCheck(l.id)}
            />
            <button
              className="layer-eye"
              title={l.visible ? '隐藏组件' : '显示组件'}
              onClick={(e) => {
                e.stopPropagation();
                toggleVisibility(l.id);
              }}
            >
              {l.visible ? '👁' : '—'}
            </button>
            <div className="layer-main">
              <InlineRename
                className="layer-name"
                value={l.name}
                onChange={(name) => renameLayer(l.id, name)}
              />
              <div className="layer-tags">
                <span className={`dim-tag ${l.dimension === '2D' ? 'd2' : 'd3'}`}>
                  {l.dimension}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );

  const tabs = (
    <div className="tabs">
      {(['all', '3D', '2D'] as const).map((f) => (
        <button
          key={f}
          className={filter === f ? 'active' : ''}
          onClick={() => setFilter(f)}
        >
          {f === 'all' ? '全部' : f}
        </button>
      ))}
    </div>
  );

  const mergeBtn = !hideMerge && (
    <button
      className="btn ghost block"
      style={embedded ? { marginTop: 8 } : undefined}
      disabled={checkedIds.size < 2}
      onClick={onMerge}
    >
      <span className="btn-ico" aria-hidden>
        🔗
      </span>
      合并已选{embedded ? '' : '组件'}
      {checkedIds.size > 0 ? `（${checkedIds.size}）` : ''}
    </button>
  );

  if (embedded) {
    return (
      <div className="component-tree-embed">
        {tabs}
        <div className="component-tree-list">{list}</div>
        {mergeBtn}
      </div>
    );
  }

  return (
    <aside className="panel right">
      <div className="panel-scroll">
        <h4 style={{ marginBottom: 10 }}>组件列表</h4>
        {tabs}
        {list}
      </div>
      <div className="panel-footer">{mergeBtn}</div>
    </aside>
  );
}
