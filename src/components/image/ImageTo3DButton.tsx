import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { useAssetStore } from '../../store/useAssetStore';
import { ensureCanAddModel, MSG_MODEL_CAP } from '../../store/assetQuota';

/** Shared CTA: hand current image editor result into 图生模型. */
export function ImageTo3DButton({
  className = '',
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const start3DFromImageEditor = useAppStore((s) => s.start3DFromImageEditor);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const busy = useImageStore((s) => s.busy);
  const modelCount = useAssetStore((s) => s.counts().model);
  const modelLimit = useAssetStore((s) => s.limits().model);
  const disabledByLimit = modelCount >= modelLimit;

  if (!currentUrl) return null;

  return (
    <button
      type="button"
      className={`btn holo ${size} img-to-3d-btn ${className}`.trim()}
      disabled={busy || disabledByLimit}
      title={
        disabledByLimit
          ? MSG_MODEL_CAP
          : '将当前图片送入图生模型：分析图层 → 生成三维场景'
      }
      onClick={async () => {
        if (!(await ensureCanAddModel())) return;
        start3DFromImageEditor();
      }}
    >
      <span className="img-to-3d-icon" aria-hidden>
        ⬡
      </span>
      生成三维场景模型
    </button>
  );
}
