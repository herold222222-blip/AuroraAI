import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { runAiEdit } from '../../image/runAiEdit';

/** Compact regenerate control, placed directly under the canvas image. */
export function ImageRegenerateBar() {
  const pushToast = useAppStore((s) => s.pushToast);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const originalUrl = useImageStore((s) => s.originalUrl);
  const lastGeneratePrompt = useImageStore((s) => s.lastGeneratePrompt);
  const prompt = useImageStore((s) => s.prompt);
  const busy = useImageStore((s) => s.busy);
  const setBusy = useImageStore((s) => s.setBusy);
  const commitImage = useImageStore((s) => s.commitImage);
  const setLastGeneratePrompt = useImageStore((s) => s.setLastGeneratePrompt);
  const savedImages = useImageStore((s) => s.savedImages);

  const reusePrompt = (lastGeneratePrompt || prompt || '').trim();
  const isResult =
    Boolean(currentUrl) &&
    Boolean(originalUrl) &&
    currentUrl !== originalUrl &&
    savedImages.some((s) => s.url === currentUrl);

  if (!isResult || !currentUrl || !originalUrl) return null;

  const onRegenerate = () => {
    const p = reusePrompt;
    if (!p) {
      pushToast('没有可复用的提示词，请先在下方输入后生成', 'info');
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        setLastGeneratePrompt(p);
        const out = await runAiEdit({
          prompt: p,
          imageUrl: originalUrl,
          forceGlobal: true,
        });
        commitImage(out, { compareFrom: originalUrl, prompt: p });
        pushToast('已重新生成', 'success');
      } catch (err) {
        pushToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="img-regen-under">
      <button
        type="button"
        className="img-regen-btn"
        disabled={busy || !reusePrompt}
        title={
          reusePrompt
            ? `用上次提示词基于原图重新生成：${reusePrompt}`
            : '请先完成一次生成'
        }
        onClick={onRegenerate}
      >
        {busy ? '生成中…' : '重新生成'}
      </button>
    </div>
  );
}
