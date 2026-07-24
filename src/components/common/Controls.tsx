interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Switch({ checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface CheckProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
}
export function Check({ checked, onChange }: CheckProps) {
  return (
    <span
      className={`checkbox${checked ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}
