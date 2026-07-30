import { useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { downloadImage } from '../../utils/downloadImage';

export function ImageFooterBar() {
  const pushToast = useAppStore((s) => s.pushToast);
  const undo = useImageStore((s) => s.undo);
  const redo = useImageStore((s) => s.redo);
  const past = useImageStore((s) => s.past);
  const future = useImageStore((s) => s.future);
  const resetToOriginal = useImageStore((s) => s.resetToOriginal);
  const backToSourceList = useImageStore((s) => s.backToSourceList);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const openFromUrl = useImageStore((s) => s.openFromUrl);
  const setShowCompare = useImageStore((s) => s.setShowCompare);
  const showCompare = useImageStore((s) => s.showCompare);
  const compareBeforeUrl = useImageStore((s) => s.compareBeforeUrl);
  const sourceSnapshotId = useImageStore((s) => s.sourceSnapshotId);
  const sourceAlbums = useImageStore((s) => s.sourceAlbums);
  const sourceSidebarMode = useImageStore((s) => s.sourceSidebarMode);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!currentUrl) return null;

  const snapshotMode =
    Boolean(sourceSnapshotId) ||
    sourceAlbums.some((a) => Boolean(a.sourceSnapshotId));
  const listLabel = snapshotMode ? '快照列表' : '原图列表';

  return (
    <div className="img-footer-bar">
      <button
        type="button"
        className="btn ghost sm"
        disabled={!past.length}
        onClick={undo}
      >
        撤销
      </button>
      <button
        type="button"
        className="btn ghost sm"
        disabled={!future.length}
        onClick={redo}
      >
        重做
      </button>
      <button type="button" className="btn ghost sm" onClick={resetToOriginal}>
        重置
      </button>
      <button
        type="button"
        className="btn ghost sm"
        disabled={!compareBeforeUrl}
        onClick={() => setShowCompare(!showCompare)}
      >
        {showCompare ? '关闭对比' : '前后对比'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => openFromUrl(String(reader.result));
          reader.readAsDataURL(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="btn ghost sm"
        disabled={sourceSidebarMode === 'list'}
        onClick={() => {
          backToSourceList();
          pushToast(
            snapshotMode ? '已切换到快照列表' : '已切换到原图列表',
            'info',
          );
        }}
      >
        {listLabel}
      </button>
      <button
        type="button"
        className="btn primary sm"
        onClick={() => {
          void (async () => {
            const url =
              (await useImageStore.getState().getWorkingImageUrl()) ||
              currentUrl;
            if (!url) return;
            try {
              await downloadImage(url, `aurora-edit-${Date.now()}.png`);
              pushToast('已开始下载', 'success');
            } catch {
              pushToast('下载失败', 'error');
            }
          })();
        }}
      >
        下载图像
      </button>
    </div>
  );
}
