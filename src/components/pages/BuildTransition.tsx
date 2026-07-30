import { useEffect, useState } from 'react';
import { ProgressView } from './ProgressView';
import { useAppStore } from '../../store/useAppStore';
import { BUILD_TIPS } from '../../data/tips';
import { Logo } from '../common/Logo';

export function BuildTransition() {
  const aiRunning = useAppStore((s) => s.aiRunning);
  const aiProgress = useAppStore((s) => s.aiProgress);
  const aiStage = useAppStore((s) => s.aiStage);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (!aiRunning) return;
    const t = setInterval(
      () => setTipIndex((i) => (i + 1) % BUILD_TIPS.length),
      3000,
    );
    return () => clearInterval(t);
  }, [aiRunning]);

  if (aiRunning) {
    const pct = Math.round(aiProgress * 100);
    return (
      <div className="progress-view">
        <div className="pv-logo">
          <Logo size={40} />
        </div>
        <h2 className="pv-title">Meshy 正在生成三维模型</h2>
        <div className="pv-stage">{aiStage || '提交任务…'}</div>
        <div className="pv-bar-wrap">
          <div className="pv-bar">
            <div className="pv-bar-fill" style={{ width: `${pct}%` }}>
              <span className="pv-bar-glow" />
            </div>
          </div>
          <div className="pv-percent">{pct}%</div>
        </div>
        <div className="pv-tip" key={tipIndex}>
          {BUILD_TIPS[tipIndex]}
        </div>
        <div className="pv-note">图生三维通常需要 1–3 分钟，请保持页面打开</div>
      </div>
    );
  }

  return (
    <ProgressView
      title="正在创建你的模型……"
      tips={BUILD_TIPS}
      duration={3600}
    />
  );
}
