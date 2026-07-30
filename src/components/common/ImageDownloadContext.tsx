import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { downloadImage } from '../../utils/downloadImage';
import { useAppStore } from '../../store/useAppStore';

type OpenMenu = (
  e: MouseEvent,
  url: string,
  filename?: string,
) => void;

const ImageDownloadCtx = createContext<OpenMenu>(() => {});

interface MenuState {
  x: number;
  y: number;
  url: string;
  name: string;
}

/** App-wide right-click “下载图片” menu for canvas / lightbox images. */
export function ImageDownloadProvider({ children }: { children: ReactNode }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback<OpenMenu>((e, url, filename) => {
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const mw = 140;
    const mh = 44;
    const x = Math.min(e.clientX, window.innerWidth - mw - pad);
    const y = Math.min(e.clientY, window.innerHeight - mh - pad);
    setMenu({
      x: Math.max(pad, x),
      y: Math.max(pad, y),
      url,
      name: filename || `aurora-${Date.now()}`,
    });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <ImageDownloadCtx.Provider value={openMenu}>
      {children}
      {menu &&
        createPortal(
          <div
            className="img-download-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="img-download-menu-item"
              onClick={() => {
                void (async () => {
                  try {
                    await downloadImage(menu.url, menu.name);
                    pushToast('已开始下载', 'success');
                  } catch {
                    pushToast('下载失败', 'error');
                  } finally {
                    setMenu(null);
                  }
                })();
              }}
            >
              下载图片
            </button>
          </div>,
          document.body,
        )}
    </ImageDownloadCtx.Provider>
  );
}

export function useImageDownloadMenu() {
  return useContext(ImageDownloadCtx);
}
