import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAppStore } from '../../store/useAppStore';
import { materialsForSelection } from '../../data/defaultLayers';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { ComponentTree } from './ComponentTree';
import { MaterialLibrary } from './MaterialLibrary';
import { CameraSnapshotPanel } from './CameraSnapshotPanel';

interface RightSidebar3DProps {
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
  onModifyMaterial: (swatchId: string) => void;
  onMerge: () => void;
}

const SPLIT_MIN = 18;
const SPLIT_MAX = 82;

export function RightSidebar3D({
  checkedIds,
  onToggleCheck,
  onModifyMaterial,
  onMerge,
}: RightSidebar3DProps) {
  const layers = useAppStore((s) => s.layers);
  const materialLibrary = useAppStore((s) => s.materialLibrary);
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const cameraMode = useAppStore((s) => s.cameraMode);

  const [openTree, setOpenTree] = useState(true);
  const [openMats, setOpenMats] = useState(true);
  /** Share of vertical space for the component list when both sections are open. */
  const [splitPct, setSplitPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const bothOpen = openTree && openMats;

  const selectionIds = useMemo(() => {
    if (selectedIds.length) return selectedIds;
    return selectedId ? [selectedId] : [];
  }, [selectedId, selectedIds]);

  const visibleMatCount = useMemo(
    () => materialsForSelection(materialLibrary, layers, selectionIds).length,
    [materialLibrary, layers, selectionIds],
  );

  const onSplitterPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!bothOpen) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const root = scrollRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const styles = getComputedStyle(root);
        const padTop = parseFloat(styles.paddingTop) || 0;
        const padBottom = parseFloat(styles.paddingBottom) || 0;
        const usable = rect.height - padTop - padBottom;
        if (usable <= 0) return;
        const y = ev.clientY - rect.top - padTop;
        const next = Math.min(
          SPLIT_MAX,
          Math.max(SPLIT_MIN, (y / usable) * 100),
        );
        setSplitPct(next);
      };

      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setDragging(false);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [bothOpen],
  );

  if (cameraMode) {
    return (
      <aside className="panel right right-sidebar-3d camera-mode-sidebar">
        <div className="panel-scroll right-sidebar-scroll">
          <CameraSnapshotPanel />
        </div>
      </aside>
    );
  }

  const treeStyle = bothOpen
    ? { flex: `${splitPct} 1 0px` }
    : openTree
      ? { flex: '1 1 0' }
      : undefined;

  const matsStyle = bothOpen
    ? { flex: `${100 - splitPct} 1 0px` }
    : openMats
      ? { flex: '1 1 0' }
      : undefined;

  return (
    <aside
      className={`panel right right-sidebar-3d${dragging ? ' is-resizing' : ''}`}
    >
      <div ref={scrollRef} className="panel-scroll right-sidebar-scroll">
        <CollapsibleSection
          title="组件列表"
          open={openTree}
          onToggle={() => setOpenTree((v) => !v)}
          badge={layers.length}
          style={treeStyle}
          footer={
            <button
              className="btn ghost block"
              disabled={checkedIds.size < 2}
              onClick={onMerge}
            >
              🔗 合并已选（{checkedIds.size}）
            </button>
          }
        >
          <ComponentTree
            embedded
            hideMerge
            checkedIds={checkedIds}
            onToggleCheck={onToggleCheck}
            onMerge={onMerge}
          />
        </CollapsibleSection>

        {bothOpen && (
          <div
            className={`sidebar-splitter${dragging ? ' active' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={Math.round(splitPct)}
            aria-label="拖动调整分区大小"
            title="拖动调整分区大小"
            onPointerDown={onSplitterPointerDown}
          >
            <span className="sidebar-splitter-grip" aria-hidden />
          </div>
        )}

        <CollapsibleSection
          title="材质库"
          open={openMats}
          onToggle={() => setOpenMats((v) => !v)}
          badge={visibleMatCount}
          style={matsStyle}
        >
          <MaterialLibrary onModify={onModifyMaterial} />
        </CollapsibleSection>
      </div>
    </aside>
  );
}
