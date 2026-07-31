import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { InlineRename } from '../common/InlineRename';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import { downloadImages } from '../../utils/downloadImage';
import { formatDateTime } from '../../utils/formatDateTime';
import { viewportController } from './viewportController';

export function CameraSnapshotPanel() {
  const snapshots = useAppStore((s) => s.snapshots);
  const viewingSnapshotId = useAppStore((s) => s.viewingSnapshotId);
  const previewingSnapshotId = useAppStore((s) => s.previewingSnapshotId);
  const addSnapshot = useAppStore((s) => s.addSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const renameSnapshot = useAppStore((s) => s.renameSnapshot);
  const reorderSnapshots = useAppStore((s) => s.reorderSnapshots);
  const setViewingSnapshot = useAppStore((s) => s.setViewingSnapshot);
  const setPreviewingSnapshot = useAppStore((s) => s.setPreviewingSnapshot);
  const sendSnapshotsToImage = useAppStore((s) => s.sendSnapshotsToImage);
  const pushToast = useAppStore((s) => s.pushToast);
  const openDownloadMenu = useImageDownloadMenu();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const suppressClickRef = useRef(false);
  const lastClickedIdRef = useRef<string | null>(null);

  const onAdd = () => {
    const prevView = viewingSnapshotId;
    const prevPreview = previewingSnapshotId;
    if (prevView) setViewingSnapshot(null);
    if (prevPreview) setPreviewingSnapshot(null);
    requestAnimationFrame(() => {
      const url = viewportController.captureSnapshot();
      if (!url || url === 'data:,') {
        if (prevView) setViewingSnapshot(prevView);
        if (prevPreview) setPreviewingSnapshot(prevPreview);
        pushToast('快照失败：无法读取视口画面', 'error');
        return;
      }
      const pose = viewportController.getCameraPose() ?? undefined;
      addSnapshot(url, pose);
    });
  };

  const onConfirmDelete = () => {
    if (!confirmId) return;
    removeSnapshot(confirmId);
    setSelectedIds((ids) => ids.filter((id) => id !== confirmId));
    setConfirmId(null);
  };

  const toggleSelect = (id: string, opts?: { range?: boolean }) => {
    setSelectedIds((prev) => {
      if (opts?.range && lastClickedIdRef.current) {
        const a = snapshots.findIndex((s) => s.id === lastClickedIdRef.current);
        const b = snapshots.findIndex((s) => s.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const rangeIds = snapshots.slice(lo, hi + 1).map((s) => s.id);
          return [...new Set([...prev, ...rangeIds])];
        }
      }
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
    lastClickedIdRef.current = id;
  };

  const selectAll = () => setSelectedIds(snapshots.map((s) => s.id));
  const clearSelection = () => setSelectedIds([]);

  const onSend = () => {
    if (!selectedIds.length) {
      pushToast('请先选择至少一张模型快照', 'info');
      return;
    }
    sendSnapshotsToImage(selectedIds);
  };

  const onDownload = () => {
    if (!selectedIds.length) {
      pushToast('请先选择至少一张模型快照', 'info');
      return;
    }
    const items = selectedIds
      .map((id) => snapshots.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ url: s.url, filename: s.label }));
    void (async () => {
      const n = await downloadImages(items);
      if (n > 0) pushToast(`已开始下载 ${n} 张`, 'success');
      else pushToast('下载失败', 'error');
    })();
  };

  return (
    <div className="camera-panel">
      <div className="camera-panel-head">
        <h3 className="camera-panel-title">模型快照</h3>
        <span className="camera-panel-count">{snapshots.length}</span>
      </div>
      <p className="camera-panel-hint">
        点击缩略图切换到对应拍摄角度；左上角方框勾选后可多选下载或同步。右上角放大镜可在画布区查看大图。
      </p>

      {snapshots.length > 0 && (
        <div className="camera-panel-select-bar">
          <button type="button" className="btn ghost sm" onClick={selectAll}>
            全选
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!selectedIds.length}
            onClick={clearSelection}
          >
            清空
          </button>
          <span className="camera-panel-select-count">
            已选 {selectedIds.length}
          </span>
        </div>
      )}

      <div className="camera-snap-grid">
        {snapshots.map((s) => {
          const isSelected = selectedIds.includes(s.id);
          return (
            <div
              key={s.id}
              className={`camera-snap-card${
                viewingSnapshotId === s.id ? ' active' : ''
              }${previewingSnapshotId === s.id ? ' is-previewing' : ''}${
                isSelected ? ' is-selected' : ''
              }${dragId === s.id ? ' dragging' : ''}${
                overId === s.id && dragId !== s.id ? ' drag-over' : ''
              }`}
              draggable
              onDragStart={(e) => {
                const t = e.target as HTMLElement;
                if (
                  t.closest(
                    'input, .camera-snap-delete, .camera-snap-zoom, .camera-snap-label, .inline-rename, .camera-snap-check',
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
                className={`camera-snap-check${isSelected ? ' on' : ''}`}
                title={isSelected ? '取消选择' : '选择'}
                aria-pressed={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(s.id, { range: e.shiftKey });
                }}
              >
                {isSelected ? '✓' : ''}
              </button>
              <button
                type="button"
                className="camera-snap-thumb"
                title={s.label}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  // Close image preview so the live 3D angle change is visible.
                  if (previewingSnapshotId) setPreviewingSnapshot(null);
                  // Always restore this snapshot's camera pose (even if already active).
                  setViewingSnapshot(s.id);
                  if (!s.cameraPose) {
                    pushToast('该快照未记录视角，请重新添加快照', 'info');
                  }
                }}
                onContextMenu={(e) => openDownloadMenu(e, s.url, s.label)}
              >
                <img src={s.url} alt={s.label} draggable={false} />
              </button>
              <div className="camera-snap-label">
                <div className="img-side-meta-row camera-snap-meta-row">
                  <InlineRename
                    value={s.label}
                    onChange={(name) => renameSnapshot(s.id, name)}
                    className="camera-snap-rename"
                    inputClassName="camera-snap-rename-input"
                    title="点击修改名称"
                  />
                  {s.createdAt > 0 && (
                    <span className="img-side-result-time" title="拍摄时间">
                      {formatDateTime(s.createdAt)}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="camera-snap-zoom"
                title="放大查看"
                aria-label="放大查看"
                onClick={(e) => {
                  e.stopPropagation();
                  if (previewingSnapshotId === s.id) {
                    setPreviewingSnapshot(null);
                  } else {
                    setPreviewingSnapshot(s.id);
                  }
                }}
              >
                🔍
              </button>
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
          );
        })}

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

      {snapshots.length > 0 && (
        <div className="camera-panel-footer-actions">
          <button
            type="button"
            className="btn ghost block"
            disabled={!selectedIds.length}
            title="下载选中的模型截图"
            onClick={onDownload}
          >
            下载
            {selectedIds.length > 0 ? `（${selectedIds.length}）` : ''}
          </button>
          <button
            type="button"
            className="btn holo block camera-send-image-btn"
            disabled={!selectedIds.length}
            title="将选中的模型截图同步到图片工具进行编辑"
            onClick={onSend}
          >
            同步到图片工具
            {selectedIds.length > 0 ? `（${selectedIds.length}）` : ''}
          </button>
        </div>
      )}

      {confirmId && (
        <ConfirmDialog
          message="确定删除该快照？此操作不可撤销。"
          onCancel={() => setConfirmId(null)}
          onConfirm={onConfirmDelete}
        />
      )}
    </div>
  );
}
