import { useImageStore } from '../../image/useImageStore';

export function ImageStartScreen() {
  return (
    <div className="img-start">
      <div className="img-start-inner">
        <h1 className="img-start-title">
          AI 驱动的图像编辑，
          <span className="img-start-accent">化繁为简</span>。
        </h1>
        <p className="img-start-desc">
          从右侧导入模型截图开始修图；支持自然语言全局修改、点选/涂抹局部重绘、参考素材融合、尺寸扩展与风格迁移。
        </p>

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

        <p className="img-start-hint">
          提示：在右侧「模型截图」中点击缩略图即可载入编辑；修改后可覆盖原图或另存。
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
