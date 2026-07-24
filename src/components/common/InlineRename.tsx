import { useEffect, useRef, useState } from 'react';

interface InlineRenameProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  inputClassName?: string;
  title?: string;
  maxLength?: number;
}

export function InlineRename({
  value,
  onChange,
  className = '',
  inputClassName = '',
  title = '点击修改名称',
  maxLength = 48,
}: InlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onChange(next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`inline-rename-input ${inputClassName}`.trim()}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <span
      className={`inline-rename ${className}`.trim()}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
