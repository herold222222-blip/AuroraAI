import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { LeftPanel } from '../workbench/LeftPanel';
import { Viewport3D } from '../workbench/Viewport3D';
import { ViewportChrome } from '../workbench/ViewportChrome';
import { FloatingToolbox } from '../workbench/FloatingToolbox';
import { BottomToolbar } from '../workbench/BottomToolbar';
import { TopOpBar } from '../workbench/TopOpBar';
import { MeshStatsPanel } from '../workbench/MeshStatsPanel';
import { RightSidebar3D } from '../workbench/RightSidebar3D';
import { SnapshotViewer } from '../workbench/SnapshotViewer';
import { SplitModal } from '../workbench/SplitModal';
import { MergeModal } from '../workbench/MergeModal';
import { PbrInspector } from '../workbench/PbrInspector';
import { SyncModal } from '../workbench/SyncModal';
import { ExportModal } from '../workbench/ExportModal';

type ModalState =
  | { type: 'none' }
  | { type: 'split'; id: string }
  | { type: 'merge'; ids: string[] }
  | { type: 'pbr'; layerId?: string; swatchId?: string }
  | { type: 'sync' }
  | { type: 'export' };

export function Workbench3D() {
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectLayer = useAppStore((s) => s.selectLayer);
  const pushToast = useAppStore((s) => s.pushToast);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMerge = () => {
    let ids = Array.from(checkedIds);
    if (ids.length < 2 && selectedId) {
      ids = [selectedId, ...ids.filter((x) => x !== selectedId)];
    }
    if (ids.length < 2) {
      pushToast('请至少勾选 2 个组件再合并', 'info');
      return;
    }
    setModal({ type: 'merge', ids });
  };

  const openSplit = () => {
    if (!selectedId) return;
    setModal({ type: 'split', id: selectedId });
  };

  const openPbrForLayer = (id?: string) => {
    const target = id ?? selectedId;
    if (!target) {
      pushToast('请先选择一个组件', 'info');
      return;
    }
    selectLayer(target);
    setModal({ type: 'pbr', layerId: target });
  };

  const openPbrForMaterial = (swatchId: string) => {
    setModal({ type: 'pbr', swatchId });
  };

  const close = () => {
    setModal({ type: 'none' });
    setCheckedIds(new Set());
  };

  return (
    <div className="app">
      <div className="workbench">
        <LeftPanel showRebuild />

        <section className="viewport-area">
          <Viewport3D />
          <SnapshotViewer />
          <MeshStatsPanel />
          <TopOpBar />
          <ViewportChrome />
          <FloatingToolbox
            onSplit={openSplit}
            onMerge={openMerge}
            onPbr={() => openPbrForLayer()}
          />
          <BottomToolbar
            onSync={() => setModal({ type: 'sync' })}
            onExport={() => setModal({ type: 'export' })}
          />
        </section>

        <RightSidebar3D
          checkedIds={checkedIds}
          onToggleCheck={toggleCheck}
          onModifyMaterial={openPbrForMaterial}
          onMerge={openMerge}
        />
      </div>

      {modal.type === 'split' && (
        <SplitModal sourceId={modal.id} onClose={() => setModal({ type: 'none' })} />
      )}
      {modal.type === 'merge' && (
        <MergeModal sourceIds={modal.ids} onClose={close} />
      )}
      {modal.type === 'pbr' && (
        <PbrInspector
          layerId={modal.layerId}
          swatchId={modal.swatchId}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'sync' && (
        <SyncModal onClose={() => setModal({ type: 'none' })} />
      )}
      {modal.type === 'export' && (
        <ExportModal onClose={() => setModal({ type: 'none' })} />
      )}
    </div>
  );
}
