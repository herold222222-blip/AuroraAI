import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Logo } from '../common/Logo';

interface ProgressViewProps {
  title: string;
  tips: string[];
  /** approximate total duration in ms */
  duration?: number;
}

export function ProgressView({ title, tips, duration = 3200 }: ProgressViewProps) {
  const transitionTo = useAppStore((s) => s.transitionTo);
  const goto = useAppStore((s) => s.goto);

  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      // ease-out curve so it feels responsive then settles
      const ratio = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - ratio, 2.2);
      setProgress(Math.round(eased * 100));
      if (ratio < 1) {
        raf = requestAnimationFrame(tick);
      } else if (transitionTo) {
        setTimeout(() => goto(transitionTo), 260);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, transitionTo, goto]);

  useEffect(() => {
    const t = setInterval(
      () => setTipIndex((i) => (i + 1) % tips.length),
      3000,
    );
    return () => clearInterval(t);
  }, [tips.length]);

  return (
    <div className="progress-view">
      <div className="pv-logo">
        <Logo size={40} />
      </div>
      <h2 className="pv-title">{title}</h2>

      <div className="pv-bar-wrap">
        <div className="pv-bar">
          <div className="pv-bar-fill" style={{ width: `${progress}%` }}>
            <span className="pv-bar-glow" />
          </div>
        </div>
        <div className="pv-percent">{progress}%</div>
      </div>

      <div className="pv-tip" key={tipIndex}>
        {tips[tipIndex]}
      </div>

      <div className="pv-orbit" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
