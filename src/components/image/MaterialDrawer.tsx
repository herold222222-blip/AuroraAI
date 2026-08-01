import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { STICKER_PRESETS } from '../../image/stickerPresets';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function MaterialDrawer() {
  const open = useImageStore((s) => s.materialDrawerOpen);
  const setOpen = useImageStore((s) => s.setMaterialDrawerOpen);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const overlays = useImageStore((s) => s.overlays);
  const selectedOverlayId = useImageStore((s) => s.selectedOverlayId);
  const addOverlayFromUrl = useImageStore((s) => s.addOverlayFromUrl);
  const selectOverlay = useImageStore((s) => s.selectOverlay);
  const removeOverlay = useImageStore((s) => s.removeOverlay);
  const clearOverlays = useImageStore((s) => s.clearOverlays);
  const flattenOverlays = useImageStore((s) => s.flattenOverlays);
  const updateOverlay = useImageStore((s) => s.updateOverlay);
  const pushToast = useAppStore((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'plant' | 'people' | 'mine'>('plant');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imgW, setImgW] = useState(1000);

  const presets = STICKER_PRESETS.filter((p) => p.category === tab);
  const selected = overlays.find((o) => o.id === selectedOverlayId);

  useEffect(() => {
    if (!currentUrl) return;
    const img = new Image();
    img.onload = () => setImgW(Math.max(1, img.naturalWidth));
    img.src = currentUrl;
  }, [currentUrl]);

  const place = async (src: string, name: string) => {
    if (!currentUrl) {
      pushToast('请先载入图片', 'info');
      return;
    }
    setBusy(true);
    try {
      await addOverlayFromUrl(src, name);
      pushToast(`已添加「${name}」，可拖动与缩放`, 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`img-mat-drawer${open ? ' open' : ''}`}>
      <button
        type="button"
        className="img-mat-toggle"
        onClick={() => setOpen(!open)}
        title={open ? '收起素材库' : '展开素材库'}
      >
        <span className="img-mat-caret" aria-hidden>
          {open ? '›' : '‹'}
        </span>
        <span>素材库</span>
      </button>
      {open && (
        <div className="img-mat-panel">
          <div className="img-mat-head">
            <strong>设计素材</strong>
            {overlays.length > 0 && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setConfirmClear(true)}
              >
                清空图层
              </button>
            )}
          </div>
          <p className="img-mat-hint">
            点击真实植物 / 人物抠图加入画面，拖动移动，滚轮或滑杆缩放。也可上传透明 PNG。
          </p>

          <div className="img-mat-tabs">
            {(
              [
                ['plant', '植物'],
                ['people', '人物'],
                ['mine', '上传'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab !== 'mine' ? (
            <div className="img-mat-grid">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="img-mat-item img-mat-preset"
                  disabled={busy || !currentUrl}
                  title={`添加 ${p.name}`}
                  onClick={() => void place(p.src, p.name)}
                >
                  <img src={p.src} alt={p.name} />
                  <span className="img-mat-num">{p.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/webp,image/svg+xml,image/*"
                multiple
                hidden
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  for (const f of files) {
                    const url = await readFile(f);
                    await place(
                      url,
                      f.name.replace(/\.[^.]+$/, '') || '自定义素材',
                    );
                  }
                }}
              />
              <button
                type="button"
                className="btn holo block sm"
                disabled={busy || !currentUrl}
                onClick={() => fileRef.current?.click()}
              >
                上传 PNG / SVG 镂空素材
              </button>
            </>
          )}

          {overlays.length > 0 && (
            <div className="img-mat-placed">
              <div className="img-mat-placed-head">
                已添加 ({overlays.length})
              </div>
              <div className="img-mat-placed-list">
                {overlays.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`img-mat-placed-item${
                      selectedOverlayId === o.id ? ' active' : ''
                    }`}
                    onClick={() => selectOverlay(o.id)}
                  >
                    <img src={o.url} alt={o.label} />
                    <span>{o.label}</span>
                    <span
                      className="img-mat-placed-del"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmRemoveId(o.id);
                      }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
              {selected && (
                <label className="img-mat-scale">
                  缩放
                  <input
                    type="range"
                    min={0.05}
                    max={0.65}
                    step={0.01}
                    value={Math.min(0.65, Math.max(0.05, selected.w / imgW))}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      const aspect = selected.w / Math.max(1, selected.h);
                      const w = Math.max(24, imgW * pct);
                      updateOverlay(selected.id, {
                        w,
                        h: Math.max(24, w / aspect),
                      });
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                className="btn primary block sm"
                onClick={async () => {
                  try {
                    await flattenOverlays();
                    pushToast('素材已合并到画面', 'success');
                  } catch (err) {
                    pushToast(
                      err instanceof Error ? err.message : String(err),
                      'error',
                    );
                  }
                }}
              >
                合并到画面
              </button>
            </div>
          )}
        </div>
      )}

      {confirmRemoveId && (
        <ConfirmDialog
          message="确定删除该素材图层？"
          onCancel={() => setConfirmRemoveId(null)}
          onConfirm={() => {
            removeOverlay(confirmRemoveId);
            setConfirmRemoveId(null);
          }}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          message={`确定清空全部 ${overlays.length} 个素材图层？`}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            clearOverlays();
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read fail'));
    r.readAsDataURL(file);
  });
}
