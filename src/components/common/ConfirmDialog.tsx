import { createPortal } from 'react-dom';

/** Shared secondary-confirm dialog for destructive image actions. */
export function ConfirmDialog({
  message,
  confirmLabel = '删除',
  onCancel,
  onConfirm,
}: {
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div
      className="camera-confirm-mask"
      role="dialog"
      aria-modal="true"
      onMouseDown={onCancel}
    >
      <div className="camera-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="camera-confirm-actions">
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn danger sm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
