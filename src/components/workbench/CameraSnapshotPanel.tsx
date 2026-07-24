import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { InlineRename } from '../common/InlineRename';
import { viewportController } from './viewportController';

export function CameraSnapshotPanel() {
  const snapshots = useAppStore((s) => s.snapshots);
  const viewingSnapshotId = useAppStore((s) => s.viewingSnapshotId);
  const addSnapshot = useAppStore((s) => s.addSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const renameSnapshot = useAppStore((s) => s.renameSnapshot);
  const reorderSnapshots = useAppStore((s) => s.reorderSnapshots);
  const setViewingSnapshot = useAppStore((s) => s.setViewingSnapshot);
  const pushToast = useAppStore((s) => s.pushToast);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const suppressClickRef = useRef(false);

  const onAdd = () => {
    const prev = viewingSnapshotId;
    if (prev) setViewingSnapshot(null);
    requestAnimationFrame(() => {
      const url = viewportController.captureSnapshot();
      if (!url || url === 'data:,') {
        if (prev) setViewingSnapshot(prev);
        pushToast('快照失败：无法读取视口画面', 'error');
        return;
      }
      addSnapshot(url);
    });
  };

  const onConfirmDelete = () => {
    if (!confirmId) return;
    removeSnapshot(confirmId);
    setConfirmId(null);
  };

  return (
    <div className="camera-panel">
      <div className="camera-panel-head">
        <h3 className="camera-panel-title">模型快照</h3>
        <span className="camera-panel-count">{snapshots.length}</span>
      </div>
      <p className="camera-panel-hint">
        点缩略图预览；点名称可改名；拖动可调整顺序。
      </p>

      <div className="camera-snap-grid">
        {snapshots.map((s) => (
          <div
            key={s.id}
            className={`camera-snap-card${
              viewingSnapshotId === s.id ? ' active' : ''
            }${dragId === s.id ? ' dragging' : ''}${
              overId === s.id && dragId !== s.id ? ' drag-over' : ''
            }`}
            draggable
            onDragStart={(e) => {
              const t = e.target as HTMLElement;
              if (
                t.closest(
                  'input, .camera-snap-delete, .camera-snap-label, .inline-rename',
                )
              ) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData('text/plain', s.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragId(s.id);
              setOverId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== s.id) setOverId(s.id);
            }}
            onDragLeave={() => {
              if (overId === s.id) setOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const fromId = e.dataTransfer.getData('text/plain');
              if (fromId) reorderSnapshots(fromId, s.id);
              setDragId(null);
              setOverId(null);
              suppressClickRef.current = true;
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
              suppressClickRef.current = true;
            }}
          >
            <button
              type="button"
              className="camera-snap-thumb"
              title={s.label}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                setViewingSnapshot(s.id);
              }}
            >
              <img src={s.url} alt={s.label} draggable={false} />
            </button>
            <div className="camera-snap-label">
              <InlineRename
                value={s.label}
                onChange={(name) => renameSnapshot(s.id, name)}
                className="camera-snap-rename"
                inputClassName="camera-snap-rename-input"
                title="点击修改名称"
              />
            </div>
            <button
              type="button"
              className="camera-snap-delete"
              title="删除快照"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmId(s.id);
              }}
            >
              🗑
            </button>
          </div>
        ))}

        <button
          type="button"
          className="camera-snap-card camera-snap-add"
          title="捕获当前视口快照"
          onClick={onAdd}
        >
          <span className="camera-snap-add-icon" aria-hidden>
            📷
          </span>
          <span className="camera-snap-add-text">添加快照</span>
        </button>
      </div>

      {confirmId && (
        <div className="camera-confirm-mask" role="dialog" aria-modal="true">
          <div className="camera-confirm">
            <p>确定删除该快照？此操作不可撤销。</p>
            <div className="camera-confirm-actions">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setConfirmId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger sm"
                onClick={onConfirmDelete}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
