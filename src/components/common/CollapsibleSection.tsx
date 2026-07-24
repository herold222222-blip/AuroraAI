import type { CSSProperties, ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: string | number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function CollapsibleSection({
  title,
  open,
  onToggle,
  badge,
  children,
  footer,
  className = '',
  style,
}: CollapsibleSectionProps) {
  return (
    <div
      className={`collapse-section${open ? ' open' : ''}${
        className ? ` ${className}` : ''
      }`}
      style={style}
    >
      <button type="button" className="collapse-head" onClick={onToggle}>
        <span className="collapse-caret">{open ? '▾' : '▸'}</span>
        <span className="collapse-title">{title}</span>
        {badge !== undefined && (
          <span className="collapse-badge">{badge}</span>
        )}
      </button>
      {open && (
        <>
          <div className="collapse-body">{children}</div>
          {footer && <div className="collapse-footer">{footer}</div>}
        </>
      )}
    </div>
  );
}
