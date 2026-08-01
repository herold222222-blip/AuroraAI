import { useAppStore } from '../../store/useAppStore';

interface FloatingToolboxProps {
  onSplit: () => void;
  onMerge: () => void;
  onPbr: () => void;
}

export function FloatingToolbox({
  onSplit,
  onMerge,
  onPbr,
}: FloatingToolboxProps) {
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const disabled = !selectedId;

  return (
    <div className="floating-toolbox">
      <button
        className="ft-btn"
        title="3D 图层拆分"
        disabled={disabled}
        onClick={onSplit}
      >
        <span className="ft-ico" aria-hidden>
          ✂
        </span>
        <span>拆分</span>
      </button>
      <button
        className="ft-btn"
        title="3D 图层合并"
        disabled={disabled}
        onClick={onMerge}
      >
        <span className="ft-ico" aria-hidden>
          🔗
        </span>
        <span>合并</span>
      </button>
      <button
        className="ft-btn"
        title="PBR 材质检查器"
        disabled={disabled}
        onClick={onPbr}
      >
        <span className="ft-ico" aria-hidden>
          🎨
        </span>
        <span>材质</span>
      </button>
    </div>
  );
}
