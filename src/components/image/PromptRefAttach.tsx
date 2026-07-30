import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useImageStore } from '../../image/useImageStore';
import { useAppStore } from '../../store/useAppStore';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

const MAX_REFS = 5;

function dtHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes('Files');
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read fail'));
    r.readAsDataURL(file);
  });
}

function collectImageFilesFromClipboard(dt: DataTransfer): File[] {
  const files: File[] = [];
  if (dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length && dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

/** Add image files as reference materials (图1–图5). Returns how many were added. */
export async function addPromptRefFiles(
  files: File[],
  opts?: { silentEmpty?: boolean },
): Promise<number> {
  const pushToast = useAppStore.getState().pushToast;
  const addMaterial = useImageStore.getState().addMaterial;
  if (!files.length) return 0;

  let added = 0;
  for (const f of files) {
    if (useImageStore.getState().materials.length >= MAX_REFS) {
      pushToast(`参考图最多 ${MAX_REFS} 张`, 'info');
      break;
    }
    const url = await readFile(f);
    const ok = await addMaterial(url);
    if (ok) added += 1;
    else {
      pushToast(`参考图最多 ${MAX_REFS} 张`, 'info');
      break;
    }
  }
  if (added) pushToast(`已添加 ${added} 张参考图`, 'success');
  else if (!opts?.silentEmpty && !files.length) {
    /* no-op */
  }
  return added;
}

/**
 * Paste handler for prompt dialogs: Ctrl/Cmd+V clipboard images → reference thumbs.
 * Returns true if clipboard contained images (and default paste was prevented).
 */
export async function handlePromptRefPaste(
  e: ReactClipboardEvent | ClipboardEvent,
  disabled?: boolean,
): Promise<boolean> {
  if (disabled) return false;
  const dt = e.clipboardData;
  if (!dt) return false;

  const files = collectImageFilesFromClipboard(dt);
  if (!files.length) return false;

  e.preventDefault();
  await addPromptRefFiles(files);
  return true;
}

/**
 * Drop handler for prompt dialogs: drag image files onto the dialog → reference thumbs.
 */
export async function handlePromptRefDrop(
  e: ReactDragEvent | DragEvent,
  disabled?: boolean,
): Promise<boolean> {
  if (disabled) return false;
  const dt = e.dataTransfer;
  if (!dt) return false;
  const files = collectImageFilesFromClipboard(dt);
  if (!files.length) return false;
  e.preventDefault();
  e.stopPropagation();
  await addPromptRefFiles(files);
  return true;
}

/**
 * Dialog zone: paste / drag-drop reference images onto the prompt area.
 */
export function PromptRefZone({
  className,
  disabled,
  children,
}: {
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <div
      className={`${className ?? ''}${over ? ' is-ref-drag' : ''}`.trim()}
      onPaste={(e) => {
        void handlePromptRefPaste(e, disabled);
      }}
      onDragEnter={(e) => {
        if (disabled || !dtHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !dtHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(false);
        void handlePromptRefDrop(e, disabled);
      }}
    >
      {children}
      {over && (
        <div className="img-prompt-ref-drop-hint">松开以上传参考图（最多 5 张）</div>
      )}
    </div>
  );
}

/** 「➕」上传参考图（与素材库共用，最多 5 张） */
export function PromptRefPlus({ disabled }: { disabled?: boolean }) {
  const materials = useImageStore((s) => s.materials);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = materials.length >= MAX_REFS;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          await addPromptRefFiles(files);
        }}
      />
      <button
        type="button"
        className="img-prompt-ref-plus"
        title={
          full
            ? `参考图已满（最多 ${MAX_REFS} 张）`
            : `上传参考图（最多 ${MAX_REFS} 张，图1–图${MAX_REFS}）；也可 Ctrl+V 粘贴或拖入对话框`
        }
        disabled={disabled || full}
        onClick={() => fileRef.current?.click()}
      >
        ＋
      </button>
    </>
  );
}

/** 参考图大图预览 */
export function RefImageLightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  const openDownloadMenu = useImageDownloadMenu();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="img-ref-lightbox"
      role="dialog"
      aria-label={`${label} 预览`}
      onMouseDown={onClose}
    >
      <div
        className="img-ref-lightbox-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="img-ref-lightbox-head">
          <span>{label}</span>
          <button
            type="button"
            className="img-ref-lightbox-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <img
          src={url}
          alt={label}
          className="img-ref-lightbox-img"
          onContextMenu={(e) => openDownloadMenu(e, url, label)}
        />
      </div>
    </div>,
    document.body,
  );
}

/** 已上传参考图缩略图：图1–图5，点击查看大图 */
export function PromptRefThumbs({ disabled }: { disabled?: boolean }) {
  const materials = useImageStore((s) => s.materials);
  const removeMaterial = useImageStore((s) => s.removeMaterial);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(
    null,
  );
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  if (!materials.length) return null;

  return (
    <>
      <div className="img-prompt-refs">
        {materials.map((m, i) => (
          <div key={m.id} className="img-prompt-ref-chip">
            <button
              type="button"
              className="img-prompt-ref-open"
              title={`点击查看图${i + 1}`}
              onClick={() => setPreview({ url: m.url, label: `图${i + 1}` })}
            >
              <img src={m.url} alt={`图${i + 1}`} />
              <span className="img-prompt-ref-label">图{i + 1}</span>
            </button>
            <button
              type="button"
              className="img-prompt-ref-del"
              title="移除"
              disabled={disabled}
              onClick={() => setConfirmRemoveId(m.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <RefImageLightbox
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      )}
      {confirmRemoveId && (
        <ConfirmDialog
          message="确定移除该参考图？"
          confirmLabel="移除"
          onCancel={() => setConfirmRemoveId(null)}
          onConfirm={() => {
            removeMaterial(confirmRemoveId);
            setConfirmRemoveId(null);
          }}
        />
      )}
    </>
  );
}
