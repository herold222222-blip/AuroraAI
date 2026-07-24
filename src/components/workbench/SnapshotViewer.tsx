import { useAppStore } from '../../store/useAppStore';

/** Full-viewport overlay that shows a selected history snapshot. */
export function SnapshotViewer() {
  const snapshots = useAppStore((s) => s.snapshots);
  const viewingSnapshotId = useAppStore((s) => s.viewingSnapshotId);
  const setViewingSnapshot = useAppStore((s) => s.setViewingSnapshot);

  const shot = snapshots.find((s) => s.id === viewingSnapshotId);
  if (!shot) return null;

  return (
    <div className="snapshot-viewer" role="dialog" aria-label={shot.label}>
      <button
        type="button"
        className="snapshot-viewer-close"
        title="关闭预览"
        aria-label="关闭预览"
        onClick={() => setViewingSnapshot(null)}
      >
        ×
      </button>
      <img src={shot.url} alt={shot.label} className="snapshot-viewer-img" />
      <div className="snapshot-viewer-caption">{shot.label}</div>
    </div>
  );
}
