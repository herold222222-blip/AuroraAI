import { useAppStore } from '../../store/useAppStore';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';

/** Full-viewport overlay that shows a snapshot image (magnifier). */
export function SnapshotViewer() {
  const snapshots = useAppStore((s) => s.snapshots);
  const previewingSnapshotId = useAppStore((s) => s.previewingSnapshotId);
  const setPreviewingSnapshot = useAppStore((s) => s.setPreviewingSnapshot);
  const openDownloadMenu = useImageDownloadMenu();

  const shot = snapshots.find((s) => s.id === previewingSnapshotId);
  if (!shot) return null;

  return (
    <div className="snapshot-viewer" role="dialog" aria-label={shot.label}>
      <button
        type="button"
        className="snapshot-viewer-close"
        title="关闭预览"
        aria-label="关闭预览"
        onClick={() => setPreviewingSnapshot(null)}
      >
        ×
      </button>
      <img
        src={shot.url}
        alt={shot.label}
        className="snapshot-viewer-img"
        onContextMenu={(e) => openDownloadMenu(e, shot.url, shot.label)}
      />
      <div className="snapshot-viewer-caption">{shot.label}</div>
    </div>
  );
}
