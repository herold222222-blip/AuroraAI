import { useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';

const INTERACTIVE =
  'button, a[href], [role="button"], input, select, textarea, summary, label';

const STAGE =
  '.upload-box, .img-stage, .img-stage-media, .canvas-2d, .vp-host, canvas';

function isFree(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  // Portaled modals (login/help) live outside data-auth-free wrappers
  return Boolean(target.closest('[data-auth-free], .modal-mask'));
}

/**
 * Visitors may browse pages; any feature interaction opens the login modal.
 */
export function AuthGuard() {
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);

  useEffect(() => {
    if (user) return;

    const block = (e: Event) => {
      if (isFree(e.target)) return;
      const el = e.target as Element;
      const hit =
        el.closest(INTERACTIVE) ||
        el.closest(STAGE) ||
        el.closest('[data-auth-required]');
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      openLogin();
    };

    const blockDrop = (e: DragEvent) => {
      if (isFree(e.target)) return;
      const el = e.target as Element | null;
      if (!el?.closest('.upload-box')) return;
      e.preventDefault();
      e.stopPropagation();
      openLogin();
    };

    document.addEventListener('click', block, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('change', block, true);
    document.addEventListener('drop', blockDrop, true);
    return () => {
      document.removeEventListener('click', block, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('change', block, true);
      document.removeEventListener('drop', blockDrop, true);
    };
  }, [user, openLogin]);

  return null;
}
