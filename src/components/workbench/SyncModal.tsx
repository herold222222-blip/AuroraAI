import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';

export function SyncModal({ onClose }: { onClose: () => void }) {
  const layers = useAppStore((s) => s.layers);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState<string | null>(null);

  const sync = (target: string) => {
    setBusy(target);
    setTimeout(() => {
      setBusy(null);
      // failure branch: nothing visible to sync
      const visible = layers.some((l) => l.visible);
      if (!visible) {
        pushToast('同步失败，请重新同步', 'error');
      } else {
        pushToast(`同步成功 · 已发送到 ${target}`, 'success');
        onClose();
      }
    }, 900);
  };

  return (
    <Modal
      title="🔄 同步至设计软件"
      subtitle="将当前 3D 白模场景推送到桌面设计软件"
      width={380}
      onClose={onClose}
    >
      <div className="sync-list">
        <button
          className="sync-target"
          disabled={busy !== null}
          onClick={() => sync('SketchUp')}
        >
          <span className="sync-ico" style={{ background: '#e8453c' }}>
            SU
          </span>
          <span className="sync-name">发送到 SketchUp</span>
          <span className="sync-state">
            {busy === 'SketchUp' ? '同步中…' : '→'}
          </span>
        </button>
        <button
          className="sync-target"
          disabled={busy !== null}
          onClick={() => sync('Revit')}
        >
          <span className="sync-ico" style={{ background: '#1a6fb5' }}>
            RV
          </span>
          <span className="sync-name">发送到 Revit</span>
          <span className="sync-state">
            {busy === 'Revit' ? '同步中…' : '→'}
          </span>
        </button>
      </div>
    </Modal>
  );
}
