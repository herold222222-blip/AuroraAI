import { useEffect } from 'react';
import { useImageStore } from '../../image/useImageStore';

export function RetouchToolbar() {
  const tab = useImageStore((s) => s.tab);
  const tool = useImageStore((s) => s.retouchTool);
  const setTool = useImageStore((s) => s.setRetouchTool);
  const brushSize = useImageStore((s) => s.brushSize);
  const setBrushSize = useImageStore((s) => s.setBrushSize);
  const sketchBrushSize = useImageStore((s) => s.sketchBrushSize);
  const setSketchBrushSize = useImageStore((s) => s.setSketchBrushSize);

  useEffect(() => {
    if (tab !== 'retouch') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, setTool]);

  if (tab !== 'retouch') return null;

  return (
    <div className="img-retouch-toolbar">
      <button
        type="button"
        className={`img-tool-btn${tool === 'select' ? ' active' : ''}`}
        title="选择工具（滚轮缩放；放大后中键拖拽平移；Esc 回到此工具）"
        onClick={() => setTool('select')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5.5 3.5l14 8.2-6.2 1.6-1.6 6.2L5.5 3.5z"
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
            fill="currentColor"
            d="M10.6 2.8c.72 0 1.3.58 1.3 1.3v7.05c.18-.08.38-.12.58-.12.5 0 .95.22 1.25.6.22-.28.56-.46.95-.46.72 0 1.3.58 1.3 1.3v.95c.2-.08.42-.12.65-.12.72 0 1.3.58 1.3 1.3v2.35c0 1.55-.55 3.05-1.55 4.2l-.55.65c-.42.5-1.05.78-1.7.78H9.55c-.95 0-1.82-.5-2.3-1.32L5.05 16.9c-.52-.9-.18-2.05.75-2.52l1.72-.88c.32-.16.7-.18 1.05-.05l.73.3V4.1c0-.72.58-1.3 1.3-1.3z"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`img-tool-btn${tool === 'point' ? ' active' : ''}`}
        title="素描标记（按住左键连续勾画红色笔迹；每次笔画为独立编号标记；Shift+点击可删除）"
        onClick={() => setTool('point')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 18.5c2.2-1.2 4.2-4.6 5.8-7.4C11.6 7.8 13.2 5 15.2 4.2c1.4-.55 2.9-.1 3.9 1.1.9 1.1.95 2.65.1 3.9-1.4 2.05-4.35 3.35-6.95 4.55L8.5 15.5 4 18.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M13.2 6.2l3.8 3.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`img-tool-btn${tool === 'eraser' ? ' active' : ''}`}
        title="橡皮擦：逐个撤销涂抹区域或素描标记"
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
      {tool === 'point' && (
        <div className="img-brush-size">
          <input
            type="range"
            min={1}
            max={40}
            value={sketchBrushSize}
            onChange={(e) => setSketchBrushSize(Number(e.target.value))}
            title={`素描笔宽 ${sketchBrushSize}px`}
            aria-label="素描笔宽"
            className="img-brush-range"
          />
          <span>{sketchBrushSize}</span>
        </div>
      )}
    </div>
  );
}
