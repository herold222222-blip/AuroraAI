import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { EditTool } from '../../types';

type OpId = EditTool | 'copy' | 'delete' | 'undo' | 'redo';

const TOOLS: { id: OpId; label: string; icon: string; shortcut?: string }[] = [
  { id: 'select', label: '选择', icon: '⬚', shortcut: 'V' },
  { id: 'move', label: '移动', icon: '✥', shortcut: 'M' },
  { id: 'rotate', label: '旋转', icon: '⟳', shortcut: 'R' },
  { id: 'copy', label: '复制', icon: '⧉', shortcut: 'C' },
  { id: 'scale', label: '缩放', icon: '⤡', shortcut: 'S' },
  { id: 'delete', label: '删除', icon: '🗑', shortcut: 'Del' },
  { id: 'undo', label: '撤销', icon: '↶' },
  { id: 'redo', label: '重做', icon: '↷' },
];

const MODE_TOOLS: EditTool[] = ['select', 'move', 'rotate', 'scale'];

export function TopOpBar() {
  const editTool = useAppStore((s) => s.editTool);
  const setEditTool = useAppStore((s) => s.setEditTool);
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const duplicateLayer = useAppStore((s) => s.duplicateLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const pushToast = useAppStore((s) => s.pushToast);
  const view = useAppStore((s) => s.view);

  const needSelection = () => {
    const id = selectedId ?? selectedIds[0];
    if (!id) {
      pushToast('请先选择一个组件', 'info');
      return null;
    }
    return id;
  };

  const run = (id: OpId) => {
    if (MODE_TOOLS.includes(id as EditTool)) {
      setEditTool(id as EditTool);
      return;
    }
    if (id === 'undo') {
      undo();
      return;
    }
    if (id === 'redo') {
      redo();
      return;
    }
    if (id === 'copy') {
      const sid = needSelection();
      if (sid) duplicateLayer(sid);
      return;
    }
    if (id === 'delete') {
      const sid = needSelection();
      if (sid) removeLayer(sid);
    }
  };

  useEffect(() => {
    if (view !== 'workbench3d') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;

      const key = e.key;
      if (key === 'Escape') {
        // Let open modals consume Escape first.
        if (document.querySelector('.modal-mask')) return;
        e.preventDefault();
        clearSelection();
        setEditTool('select');
        return;
      }
      if (key === 'v' || key === 'V') {
        e.preventDefault();
        setEditTool('select');
      } else if (key === 'm' || key === 'M') {
        e.preventDefault();
        setEditTool('move');
      } else if (key === 'r' || key === 'R') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        setEditTool('rotate');
      } else if (key === 'c' || key === 'C') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const sid = selectedId ?? selectedIds[0];
        if (sid) duplicateLayer(sid);
        else pushToast('请先选择一个组件', 'info');
      } else if (key === 's' || key === 'S') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        setEditTool('scale');
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        const sid = selectedId ?? selectedIds[0];
        if (sid) removeLayer(sid);
        else pushToast('请先选择一个组件', 'info');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    view,
    setEditTool,
    clearSelection,
    selectedId,
    selectedIds,
    removeLayer,
    duplicateLayer,
    pushToast,
  ]);

  return (
    <div className="top-op-bar">
      {TOOLS.map((tool) => {
        const isMode = MODE_TOOLS.includes(tool.id as EditTool);
        const active = isMode && editTool === tool.id;
        return (
          <span key={tool.id} className="top-op-wrap">
            {tool.id === 'undo' && <span className="tool-divider" />}
            <button
              type="button"
              className={`top-op-btn${active ? ' active' : ''}`}
              title={
                tool.shortcut
                  ? `${tool.label}（${tool.shortcut}）`
                  : tool.label
              }
              onClick={() => run(tool.id)}
            >
              <span className="top-op-icon">{tool.icon}</span>
              <span className="top-op-label">{tool.label}</span>
              {tool.shortcut && (
                <span className="top-op-key">{tool.shortcut}</span>
              )}
            </button>
          </span>
        );
      })}
    </div>
  );
}
