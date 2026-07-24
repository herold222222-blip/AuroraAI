import { useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';

export function ImageFooterBar() {
  const pushToast = useAppStore((s) => s.pushToast);
  const undo = useImageStore((s) => s.undo);
  const redo = useImageStore((s) => s.redo);
  const past = useImageStore((s) => s.past);
  const future = useImageStore((s) => s.future);
  const resetToOriginal = useImageStore((s) => s.resetToOriginal);
  const clearEditor = useImageStore((s) => s.clearEditor);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const openFromUrl = useImageStore((s) => s.openFromUrl);
  const setShowCompare = useImageStore((s) => s.setShowCompare);
  const showCompare = useImageStore((s) => s.showCompare);
  const compareBeforeUrl = useImageStore((s) => s.compareBeforeUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!currentUrl) return null;

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
        onClick={() => {
          clearEditor();
          pushToast('已返回起始页，可重新导入', 'info');
        }}
      >
        上传新图
      </button>
      <button
        type="button"
        className="btn primary sm"
        onClick={() => {
          const a = document.createElement('a');
          a.href = currentUrl;
          a.download = `aurora-edit-${Date.now()}.png`;
          a.click();
          pushToast('已开始下载', 'success');
        }}
      >
        下载图像
      </button>
    </div>
  );
}
