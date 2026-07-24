import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function ProjectSwitcher() {
  const projectName = useAppStore((s) => s.projectName);
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const switchProject = useAppStore((s) => s.switchProject);
  const createProject = useAppStore((s) => s.createProject);
  const setProjectName = useAppStore((s) => s.setProjectName);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(projectName);
  }, [projectName, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commitRename = () => {
    setProjectName(draft);
    setEditing(false);
  };

  return (
    <div className={`project-switcher${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="project-switcher-trigger"
        title="切换或新建项目"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="project-switcher-name">{projectName}</span>
        <span className="project-switcher-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="project-switcher-menu" role="listbox">
          <div className="project-switcher-menu-head">
            <span>项目</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(projectName);
                setEditing(true);
              }}
            >
              重命名
            </button>
          </div>

          {editing && (
            <div className="project-switcher-rename">
              <input
                ref={inputRef}
                className="input"
                value={draft}
                maxLength={48}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditing(false);
                }}
                onBlur={commitRename}
              />
            </div>
          )}

          <ul className="project-switcher-list">
            {[...projects]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`project-switcher-item${
                      p.id === activeProjectId ? ' active' : ''
                    }`}
                    onClick={() => {
                      switchProject(p.id);
                      setOpen(false);
                    }}
                  >
                    <span className="project-switcher-item-name">{p.name}</span>
                    {p.id === activeProjectId && (
                      <span className="project-switcher-check">✓</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>

          <button
            type="button"
            className="project-switcher-new"
            onClick={() => {
              createProject();
              setOpen(false);
            }}
          >
            ＋ 新建项目
          </button>
        </div>
      )}
    </div>
  );
}
