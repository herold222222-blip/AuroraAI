import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { defaultFormalProjectName } from '../../store/projectBag';
import { Modal } from './Modal';

export function ProjectPromoteModal() {
  const pendingPromote = useAppStore((s) => s.pendingPromote);
  const confirmPendingPromote = useAppStore((s) => s.confirmPendingPromote);
  const cancelPendingPromote = useAppStore((s) => s.cancelPendingPromote);
  const [name, setName] = useState(defaultFormalProjectName());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingPromote) return;
    setName(defaultFormalProjectName());
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(t);
  }, [pendingPromote]);

  if (!pendingPromote) return null;

  const subtitle =
    pendingPromote.kind === 'toImage'
      ? '将模型截图同步到图片工具前，需要先为当前工作立项。'
      : '从图生模型前，需要先为当前工作立项。当前原图进入新项目，其余原图仍留在未立项空间。';

  const onConfirm = () => {
    confirmPendingPromote(name);
  };

  return (
    <Modal
      title="确认新立项"
      subtitle={subtitle}
      width={420}
      onClose={cancelPendingPromote}
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={cancelPendingPromote}
          >
            取消
          </button>
          <button type="button" className="btn holo" onClick={onConfirm}>
            立项并继续
          </button>
        </>
      }
    >
      <label className="project-promote-label" htmlFor="project-promote-name">
        项目名称
      </label>
      <input
        id="project-promote-name"
        ref={inputRef}
        className="input"
        value={name}
        maxLength={48}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm();
        }}
        placeholder={defaultFormalProjectName()}
      />
      <p className="project-promote-hint">
        {pendingPromote.kind === 'to3d'
          ? '立项后可随时切回「未立项空间」继续处理其余原图。'
          : '立项后可随时在顶部下拉切回「未立项空间」。'}
      </p>
    </Modal>
  );
}
