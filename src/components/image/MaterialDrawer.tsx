import { useRef } from 'react';
import { useImageStore } from '../../image/useImageStore';

export function MaterialDrawer() {
  const open = useImageStore((s) => s.materialDrawerOpen);
  const setOpen = useImageStore((s) => s.setMaterialDrawerOpen);
  const materials = useImageStore((s) => s.materials);
  const addMaterial = useImageStore((s) => s.addMaterial);
  const toggleMaterial = useImageStore((s) => s.toggleMaterial);
  const clearMaterials = useImageStore((s) => s.clearMaterials);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`img-mat-drawer${open ? ' open' : ''}`}>
      <button
        type="button"
        className="img-mat-toggle"
        onClick={() => setOpen(!open)}
        title={open ? '收起素材库' : '展开素材库'}
      >
        {open ? '›' : '‹'}
        <span>素材库</span>
      </button>
      {open && (
        <div className="img-mat-panel">
          <div className="img-mat-head">
            <strong>参考素材</strong>
            <button type="button" className="btn ghost sm" onClick={clearMaterials}>
              清空
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              for (const f of files) {
                const url = await readFile(f);
                await addMaterial(url);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn ghost block sm"
            onClick={() => fileRef.current?.click()}
          >
            上传参考图
          </button>
          <div className="img-mat-grid">
            {materials.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`img-mat-item${m.selected ? ' selected' : ''}`}
                onClick={() => toggleMaterial(m.id)}
              >
                <img src={m.url} alt="" />
                {m.selected && <span className="img-mat-check">✓</span>}
              </button>
            ))}
          </div>
          <p className="img-mat-hint">勾选的素材将作为 Gemini 参考输入。</p>
        </div>
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
