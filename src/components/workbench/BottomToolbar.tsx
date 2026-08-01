import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { Switch } from '../common/Controls';
import type { SurfaceMode, TopologyType } from '../../types';

interface BottomToolbarProps {
  onSync: () => void;
  onExport: () => void;
}

const SURFACE: { value: SurfaceMode; label: string }[] = [
  { value: 'wireframe', label: '线框' },
  { value: 'solid', label: '白模' },
  { value: 'shaded', label: '着色' },
  { value: 'textured', label: '贴图' },
];

const TOPO_OPTIONS: { value: TopologyType; label: string; hint: string }[] = [
  { value: 'triangle', label: '三角面', hint: '兼容性更好，适合通用导出' },
  { value: 'quad', label: '四边面', hint: '利于 Rhino / SketchUp 深化' },
];

export function BottomToolbar({ onSync, onExport }: BottomToolbarProps) {
  const viewport = useAppStore((s) => s.viewport);
  const setViewport = useAppStore((s) => s.setViewport);
  const config = useAppStore((s) => s.config);
  const retopologizeAll = useAppStore((s) => s.retopologizeAll);
  const cameraMode = useAppStore((s) => s.cameraMode);
  const toggleCameraMode = useAppStore((s) => s.toggleCameraMode);

  const [topoOpen, setTopoOpen] = useState(false);
  const [topoDraft, setTopoDraft] = useState<TopologyType>(config.topology);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!topoOpen || !btnRef.current) return;
    const place = () => {
      const rect = btnRef.current!.getBoundingClientRect();
      const width = 220;
      const gap = 10;
      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      setPopoverPos({
        top: rect.top - gap,
        left,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [topoOpen]);

  useEffect(() => {
    if (!topoOpen) return;
    setTopoDraft(config.topology);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setTopoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTopoOpen(false);
    };
    // defer so the opening click doesn't immediately close
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [topoOpen, config.topology]);

  const confirmTopo = () => {
    retopologizeAll(topoDraft);
    setTopoOpen(false);
  };

  return (
    <div className="bottom-toolbar">
      <div className="tool-group bottom-display">
        <div className="bottom-toggle" title="网格显示（仅预览）">
          <span className="bottom-toggle-text">网格</span>
          <Switch
            checked={viewport.grid}
            onChange={(v) => setViewport({ grid: v })}
          />
        </div>
        <div className="bottom-toggle" title="环境光（仅预览）">
          <span className="bottom-toggle-text">环境光</span>
          <Switch
            checked={viewport.ambientLight}
            onChange={(v) => setViewport({ ambientLight: v })}
          />
        </div>
        <div className="surface-modes compact">
          <span
            className="surface-chip pbr-chip"
            title="PBR 预览状态（由材质设置控制，不可点击）"
            aria-disabled="true"
          >
            PBR
          </span>
          {SURFACE.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`surface-chip${
                viewport.surfaceMode === s.value ? ' active' : ''
              }`}
              onClick={() => setViewport({ surfaceMode: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tool-divider" />

      <div className="tool-group">
        <div className="topo-menu">
          <button
            ref={btnRef}
            type="button"
            className={`btn ghost sm${topoOpen ? ' active' : ''}`}
            title="重拓扑"
            aria-expanded={topoOpen}
            aria-haspopup="menu"
            onClick={() => setTopoOpen((v) => !v)}
          >
            <span className="btn-ico" aria-hidden>
              ◈
            </span>
            重拓扑
          </button>
          {topoOpen &&
            createPortal(
              <div
                ref={popoverRef}
                className="topo-popover"
                role="menu"
                style={{
                  top: popoverPos.top,
                  left: popoverPos.left,
                  transform: 'translateY(-100%)',
                }}
              >
                <div className="topo-popover-title">选择拓扑参数</div>
                {TOPO_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`topo-option${
                      topoDraft === o.value ? ' active' : ''
                    }`}
                    onClick={() => setTopoDraft(o.value)}
                  >
                    <span className="topo-option-main">
                      <b>{o.label}</b>
                      {topoDraft === o.value && (
                        <span className="topo-check">✓</span>
                      )}
                    </span>
                    <span className="topo-option-hint">{o.hint}</span>
                  </button>
                ))}
                <div className="topo-popover-actions">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setTopoOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn holo sm"
                    onClick={confirmTopo}
                  >
                    确认
                  </button>
                </div>
              </div>,
              document.body,
            )}
        </div>
        <button
          type="button"
          className={`btn ghost sm${cameraMode ? ' active' : ''}`}
          title={cameraMode ? '退出相机模式' : '进入相机模式'}
          onClick={() => toggleCameraMode()}
        >
          <span className="btn-ico" aria-hidden>
            📷
          </span>
          相机
        </button>
        <button className="btn ghost sm" onClick={onSync} title="导出至设计软件">
          <span className="btn-ico" aria-hidden>
            📤
          </span>
          导出
        </button>
        <button className="btn green sm" onClick={onExport} title="下载模型文件">
          <span className="btn-ico" aria-hidden>
            ⬇
          </span>
          下载
        </button>
      </div>
    </div>
  );
}
