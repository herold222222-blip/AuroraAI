import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';

const EXAMPLES = [
  { src: '/examples/example-1.jpg', name: '山谷溪流景观' },
  { src: '/examples/example-2.jpg', name: '滨水历史街区' },
  { src: '/examples/example-3.jpg', name: '疏林草地公园' },
  { src: '/examples/example-4.jpg', name: '跌水森林景观' },
];

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;

export function ImageStartScreen() {
  const openFromUrl = useImageStore((s) => s.openFromUrl);
  const pushToast = useAppStore((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const acceptFile = (file: File) => {
    if (!ACCEPT.includes(file.type)) {
      pushToast('仅支持 JPG / PNG / WEBP 格式图片', 'error');
      return;
    }
    if (file.size > MAX_SIZE) {
      pushToast('单张图片不能超过 20MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      openFromUrl(String(reader.result), {
        label: file.name.replace(/\.[^.]+$/, '') || undefined,
      });
    reader.readAsDataURL(file);
  };

  return (
    <div className="img-start">
      <div className="img-start-inner">
        <h1 className="img-start-title">
          AI 驱动的图像编辑，
          <span className="img-start-accent">化繁为简</span>。
        </h1>
        <p className="img-start-desc">
          上传图片后即可修图；改图完成后可生成三维场景，打通图生模型与模型生图闭环。
        </p>

        <div
          className={`upload-box img-start-upload-box${drag ? ' drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file) acceptFile(file);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
              e.target.value = '';
            }}
          />
          <div className="upload-inner">
            <div className="upload-icon">⬆</div>
            <div className="upload-title">点击选择，或将图片拖拽到此处</div>
            <div className="upload-hint">
              支持 JPG / PNG / WEBP，单张上限 20MB
            </div>
          </div>
        </div>

        <div className="img-feature-grid">
          <article className="img-feature-card">
            <h3>精确修图</h3>
            <p>
              点击图像上的任意点或涂抹精确区域，即可精准去除瑕疵、更改颜色或添加元素。
            </p>
          </article>
          <article className="img-feature-card">
            <h3>创意滤镜</h3>
            <p>一键切换春/夏/秋/冬场景及白天/黄昏/夜景光影氛围。</p>
          </article>
          <article className="img-feature-card">
            <h3>调整尺寸</h3>
            <p>一键扩图/缩图，生成 4K 成品图片。</p>
          </article>
        </div>

        <p className="img-start-examples-title">或选择示例图快速体验</p>
        <div className="img-start-examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.src}
              type="button"
              className="img-start-example"
              onClick={() => openFromUrl(ex.src, { label: ex.name })}
            >
              <img src={ex.src} alt={ex.name} />
              <span>{ex.name}</span>
            </button>
          ))}
        </div>

        <p className="img-start-hint">
          本地上传改图后，右侧会自动保存生成结果
        </p>
      </div>
    </div>
  );
}

export function ImageModeBadge() {
  const hotspots = useImageStore((s) => s.hotspots);
  const brushRegions = useImageStore((s) => s.brushRegions);
  const hasMask = useImageStore((s) => s.hasMask);
  const local = hotspots.length > 0 || brushRegions.length > 0 || hasMask;

  let label = '当前模式：全局修改';
  if (brushRegions.length > 1) {
    label = `当前模式：局部修改（${brushRegions.length} 涂抹区域）`;
  } else if (hotspots.length > 1) {
    label = `当前模式：局部修改（${hotspots.length} 点）`;
  } else if (local) {
    label = '当前模式：局部修改';
  }

  return (
    <div className={`img-mode-badge${local ? ' local' : ''}`}>
      <span className={`img-mode-dot${local ? ' pulse' : ''}`} />
      {label}
    </div>
  );
}
