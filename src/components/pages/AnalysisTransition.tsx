import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Logo } from '../common/Logo';
import { ANALYSIS_TIPS } from '../../data/tips';

export function AnalysisTransition() {
  const stage = useAppStore((s) => s.aiStage);
  const progress = useAppStore((s) => s.aiProgress);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setTipIndex((i) => (i + 1) % ANALYSIS_TIPS.length),
      3000,
    );
    return () => clearInterval(t);
  }, []);

  const pct = Math.round(progress * 100);

  return (
    <div className="progress-view">
      <div className="pv-logo">
        <Logo size={40} />
      </div>
      <h2 className="pv-title">正在分析场景</h2>
      <div className="pv-stage">{stage || '正在初始化 AI 模型'}</div>

      <div className="pv-bar-wrap">
        <div className="pv-bar">
          <div className="pv-bar-fill" style={{ width: `${pct}%` }}>
            <span className="pv-bar-glow" />
          </div>
        </div>
        <div className="pv-percent">{pct}%</div>
      </div>

      <div className="pv-tip" key={tipIndex}>
        {ANALYSIS_TIPS[tipIndex]}
      </div>

      <div className="pv-note">
        首次运行需下载 AI 模型（语义分割 + 深度估算），请稍候……
      </div>

      <div className="pv-orbit" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
