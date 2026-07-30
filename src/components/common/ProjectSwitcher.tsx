import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  defaultFormalProjectName,
  isScratchProjectId,
  SCRATCH_PROJECT_ID,
} from '../../store/projectBag';
import { Modal } from './Modal';

type NameModalKind = 'promote' | 'copy' | 'blank';

export function ProjectSwitcher() {
  const projectName = useAppStore((s) => s.projectName);
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const switchProject = useAppStore((s) => s.switchProject);
  const promoteCurrentToProject = useAppStore((s) => s.promoteCurrentToProject);
  const createBlankProject = useAppStore((s) => s.createBlankProject);
  const removeProject = useAppStore((s) => s.removeProject);
  const setProjectName = useAppStore((s) => s.setProjectName);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const [nameModal, setNameModal] = useState<NameModalKind | null>(null);
  const [modalName, setModalName] = useState(defaultFormalProjectName());
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);

  const isScratch = isScratchProjectId(activeProjectId);

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
    if (!nameModal) return;
    const base = defaultFormalProjectName();
    setModalName(
      nameModal === 'copy' ? `${projectName} 副本`.slice(0, 48) : base,
    );
    const t = window.setTimeout(() => {
      modalInputRef.current?.focus();
      modalInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(t);
  }, [nameModal, projectName]);

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

  const confirmNameModal = () => {
    if (!nameModal) return;
    if (nameModal === 'blank') createBlankProject(modalName);
    else promoteCurrentToProject(modalName);
    setNameModal(null);
  };

  const scratch = projects.find((p) => isScratchProjectId(p.id));
  const formal = [...projects]
    .filter((p) => !isScratchProjectId(p.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const modalCopy =
    nameModal === 'promote'
      ? {
          title: '新立项',
          subtitle: '将把当前改图 / 建模工作打包为正式项目。',
          confirm: '确认立项',
          hint: '立项后仍可切回空的「未立项空间」。',
        }
      : nameModal === 'copy'
        ? {
            title: '另存副本',
            subtitle: '复制当前项目的全部工作到新项目，原项目保留不变。',
            confirm: '确认另存',
            hint: '另存后将自动进入新副本。',
          }
        : nameModal === 'blank'
          ? {
              title: '创建空白项目',
              subtitle: '新建一个空的正式项目；当前项目会先自动保存。',
              confirm: '确认创建',
              hint: '不会带入当前图层、模型或改图结果。',
            }
          : null;

  return (
    <>
      <div className={`project-switcher${open ? ' open' : ''}`} ref={rootRef}>
        <button
          type="button"
          className="project-switcher-trigger"
          title="切换项目或新立项"
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
              {!isScratch && (
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
              )}
            </div>

            {editing && !isScratch && (
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
              {scratch && (
                <li>
                  <button
                    type="button"
                    className={`project-switcher-item${
                      activeProjectId === SCRATCH_PROJECT_ID ? ' active' : ''
                    }`}
                    onClick={() => {
                      switchProject(SCRATCH_PROJECT_ID);
                      setOpen(false);
                    }}
                  >
                    <span className="project-switcher-item-name">
                      {scratch.name}
                      <span className="project-switcher-badge">默认</span>
                    </span>
                    {activeProjectId === SCRATCH_PROJECT_ID && (
                      <span className="project-switcher-check">✓</span>
                    )}
                  </button>
                </li>
              )}
              {formal.map((p) => (
                <li key={p.id} className="project-switcher-row">
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
                  <button
                    type="button"
                    className="project-switcher-delete"
                    title="删除项目"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      setDeleteTarget({ id: p.id, name: p.name });
                    }}
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>

            {isScratch ? (
              <button
                type="button"
                className="project-switcher-new"
                onClick={() => {
                  setOpen(false);
                  setNameModal('promote');
                }}
              >
                ＋ 新立项（保存当前工作）
              </button>
            ) : (
              <div className="project-switcher-actions">
                <button
                  type="button"
                  className="project-switcher-new"
                  onClick={() => {
                    setOpen(false);
                    setNameModal('copy');
                  }}
                >
                  另存副本
                </button>
                <button
                  type="button"
                  className="project-switcher-new secondary"
                  onClick={() => {
                    setOpen(false);
                    setNameModal('blank');
                  }}
                >
                  创建空白项目
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {nameModal && modalCopy && (
        <Modal
          title={modalCopy.title}
          subtitle={modalCopy.subtitle}
          width={420}
          onClose={() => setNameModal(null)}
          footer={
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setNameModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn holo"
                onClick={confirmNameModal}
              >
                {modalCopy.confirm}
              </button>
            </>
          }
        >
          <label
            className="project-promote-label"
            htmlFor="manual-project-name"
          >
            项目名称
          </label>
          <input
            id="manual-project-name"
            ref={modalInputRef}
            className="input"
            value={modalName}
            maxLength={48}
            onChange={(e) => setModalName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmNameModal();
            }}
          />
          <p className="project-promote-hint">{modalCopy.hint}</p>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="删除项目"
          subtitle="删除后不可恢复，请确认。"
          width={400}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  removeProject(deleteTarget.id);
                  setDeleteTarget(null);
                }}
              >
                确认删除
              </button>
            </>
          }
        >
          <p className="project-promote-hint" style={{ marginTop: 0 }}>
            确定删除项目「{deleteTarget.name}」？其中的改图与建模数据将一并清除。
            {deleteTarget.id === activeProjectId
              ? ' 删除后将自动回到「未立项空间」。'
              : ''}
          </p>
        </Modal>
      )}
    </>
  );
}
