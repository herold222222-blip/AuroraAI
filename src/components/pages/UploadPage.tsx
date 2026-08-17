import { useId, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import { useAssetStore } from '../../store/useAssetStore';
import { ensureCanUploadImage, MSG_IMAGE_CAP } from '../../store/assetQuota';

const EXAMPLES = [
  { src: '/examples/example-1.jpg', name: '山谷溪流景观' },
  { src: '/examples/example-2.jpg', name: '滨水历史街区' },
  { src: '/examples/example-3.jpg', name: '疏林草地公园' },
  { src: '/examples/example-4.jpg', name: '跌水森林景观' },
];

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;

export function UploadPage() {
  const image = useAppStore((s) => s.image);
  const setImage = useAppStore((s) => s.setImage);
  const analyze = useAppStore((s) => s.analyze);
  const pushToast = useAppStore((s) => s.pushToast);
  const openDownloadMenu = useImageDownloadMenu();
  const imageAtCap = useAssetStore((s) => s.counts().image >= s.limits().image);

  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const acceptFile = async (file: File) => {
    if (!(await ensureCanUploadImage())) return;
    if (!ACCEPT.includes(file.type)) {
      pushToast('仅支持 JPG / PNG / WEBP 格式图片', 'error');
      return;
    }
    if (file.size > MAX_SIZE) {
      pushToast('单张图片不能超过 20MB', 'error');
      return;
    }
    setImage({
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void acceptFile(file);
  };

  const pickExample = async (src: string, name: string) => {
    if (!(await ensureCanUploadImage())) return;
    setImage({ url: src, name, size: 0 });
  };

  const onAnalyze = () => {
    if (!image) {
      pushToast('请先上传图片', 'info');
      return;
    }
    analyze();
  };

  return (
    <div className="app">
      <div className="upload-page">
        <div className="upload-hero">
          <div className="hero-badge">让设计效果图成为可编辑、可同步、可承载工程建造信息的3D设计状态</div>
          <h1 className="hero-title">
            一张工程设计<span className="accent-orange">2D效果图</span>，<span>数分钟</span>生成分层可编辑的<span className="accent-orange">3D设计场景</span>
          </h1>
          <p className="hero-sub">
            上传 2D 建筑/景观/室内设计效果图，Aurora 自动完成专业图层拆分与 高精度、可编辑的3D 模型构建，
            打通概念方案到三维深化建模的效率壁垒。
          </p>
        </div>

        <label
          className={`upload-box${drag ? ' drag' : ''}${image ? ' has-image' : ''}`}
          htmlFor={imageAtCap ? undefined : inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!imageAtCap) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            hidden
            disabled={imageAtCap}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async (e) => {
              if (!(await ensureCanUploadImage())) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void acceptFile(f);
              e.target.value = '';
            }}
          />
          {image ? (
            <div className="upload-preview">
              <img
                src={image.url}
                alt={image.name}
                onContextMenu={(e) =>
                  openDownloadMenu(e, image.url, image.name || 'aurora-upload')
                }
              />
              <div className="upload-preview-info">
                <span className="fname">{image.name}</span>
                <button
                  className="btn ghost sm"
                  disabled={imageAtCap}
                  title={imageAtCap ? MSG_IMAGE_CAP : undefined}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!(await ensureCanUploadImage())) return;
                    inputRef.current?.showPicker?.();
                    inputRef.current?.click();
                  }}
                >
                  更换图片
                </button>
              </div>
            </div>
          ) : (
            <div className="upload-inner">
              <div className="upload-icon">⬆</div>
              <div className="upload-title">
                {imageAtCap
                  ? '图片资产已达上限'
                  : '点击选择，或将图片拖拽到此处'}
              </div>
              <div className="upload-hint">
                {imageAtCap
                  ? MSG_IMAGE_CAP
                  : '支持 JPG / PNG / WEBP，单张上限 20MB'}
              </div>
            </div>
          )}
        </label>

        <button
          className={`btn analyze-btn${image ? ' ready' : ''}`}
          type="button"
          touch-action="manipulation"
          disabled={!image}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAnalyze();
          }}
        >
          <span className="analyze-icon" aria-hidden>
            ⚡
          </span>
          分析场景图层
        </button>

        <p className="upload-footnote">
          上传后 AI 将自动对地形、植被、水体、构筑物等景观元素进行专业图层拆分。
        </p>

        <div className="examples">
          <div className="examples-label">或选择一张示例图快速体验</div>
          <div className="examples-grid">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.src}
                className={`example-card${
                  image?.url === ex.src ? ' active' : ''
                }`}
                onClick={() => void pickExample(ex.src, ex.name)}
                disabled={imageAtCap}
                title={imageAtCap ? MSG_IMAGE_CAP : ex.name}
              >
                <img src={ex.src} alt={ex.name} />
                <span>{ex.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
