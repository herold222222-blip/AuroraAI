import { useImageStore } from '../../image/useImageStore';

export function RetouchToolbar() {
  const tab = useImageStore((s) => s.tab);
  const tool = useImageStore((s) => s.retouchTool);
  const setTool = useImageStore((s) => s.setRetouchTool);
  const brushSize = useImageStore((s) => s.brushSize);
  const setBrushSize = useImageStore((s) => s.setBrushSize);

  if (tab !== 'retouch') return null;

  return (
    <div className="img-retouch-toolbar">
      <button
        type="button"
        className={`img-tool-btn${tool === 'eraser' ? ' active' : ''}`}
        title="橡皮擦：逐个撤销涂抹区域或选点"
        onClick={() => setTool('eraser')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M7 21h10M4.5 14.5l7-7a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8l-7.5 7.5H4.5v-6.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`img-tool-btn${tool === 'point' ? ' active' : ''}`}
        title="选点工具（Shift+点击可多选；再点可选点删除）"
        onClick={() => setTool('point')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 4l7.5 16 1.8-6.7L20 11.5 4 4z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`img-tool-btn${tool === 'brush' ? ' active' : ''}`}
        title="涂抹工具（不相连区域自动编号；Shift+点击可删除某区域）"
        onClick={() => setTool('brush')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 20l4.5-1.5L19 8a2.1 2.1 0 00-3-3L5.5 15.5 4 20z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {tool === 'brush' && (
        <div className="img-brush-size">
          <input
            type="range"
            min={5}
            max={100}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            title={`画笔 ${brushSize}px`}
            aria-label="画笔大小"
            className="img-brush-range"
          />
          <span>{brushSize}</span>
        </div>
      )}
    </div>
  );
}
