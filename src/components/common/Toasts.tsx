import { useAppStore } from '../../store/useAppStore';

const ICONS: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  error: '✕',
  warning: '⚠',
};

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{ICONS[t.tone]}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
