import { useState, type ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from './Modal';

type NavId =
  | 'project'
  | 'assets'
  | 'thinktank'
  | 'model'
  | 'image'
  | 'cad'
  | 'text'
  | 'anim';

const TOP_NAV: { id: NavId; label: string; icon: ReactNode }[] = [
  {
    id: 'project',
    label: '项目',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: 'assets',
    label: '资产',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: 'thinktank',
    label: '智库',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 5.5C4 4.7 4.7 4 5.5 4H11v14H5.5C4.7 18 4 17.3 4 16.5V5.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M20 5.5C20 4.7 19.3 4 18.5 4H13v14h5.5c.8 0 1.5-.7 1.5-1.5V5.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M13 4v14" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 8h2.5M7 11h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const BOTTOM_NAV: { id: NavId; label: string; icon: ReactNode }[] = [
  {
    id: 'model',
    label: '模型',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M12 12L20 7.5M12 12V21M12 12L4 7.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: 'image',
    label: '图片',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path
          d="M3 16l5-4 4 3 3-2 6 4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'cad',
    label: 'CAD',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'text',
    label: '文本',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 6h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 6v13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8 19h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'anim',
    label: '动画',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="8" cy="6" r="2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M8 8.5l1.5 3.5 3 1.5 2.5 5M9.5 12l-3 2.5-1.5 4M12.5 13l3.5-1 2.5 2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function AppSidebar() {
  const pushToast = useAppStore((s) => s.pushToast);
  const view = useAppStore((s) => s.view);
  const enterImageModule = useAppStore((s) => s.enterImageModule);
  const enterModelModule = useAppStore((s) => s.enterModelModule);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [modelDevOpen, setModelDevOpen] = useState(false);

  const active: NavId = view === 'image' ? 'image' : 'model';

  const onNav = (id: NavId) => {
    if (id === 'model') {
      if (!isAdmin()) {
        setModelDevOpen(true);
        return;
      }
      enterModelModule();
      return;
    }
    if (id === 'image') {
      enterImageModule();
      return;
    }
    const labels: Record<NavId, string> = {
      project: '项目',
      assets: '资产',
      thinktank: '智库',
      model: '模型',
      image: '图片',
      cad: 'CAD',
      text: '文本',
      anim: '动画',
    };
    pushToast(`「${labels[id]}」功能即将上线`, 'info');
  };

  return (
    <>
      <aside className="app-sidebar" aria-label="主导航" data-auth-free>
        <div className="app-sidebar-top">
          {TOP_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-sidebar-btn${active === item.id ? ' active' : ''}`}
              onClick={() => onNav(item.id)}
              title={item.label}
            >
              <span className="app-sidebar-icon">{item.icon}</span>
              <span className="app-sidebar-label">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="app-sidebar-bottom">
          {BOTTOM_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-sidebar-btn${active === item.id ? ' active' : ''}`}
              onClick={() => onNav(item.id)}
              title={item.label}
            >
              <span className="app-sidebar-icon">{item.icon}</span>
              <span className="app-sidebar-label">{item.label}</span>
            </button>
          ))}
        </div>
      </aside>

      {modelDevOpen && (
        <div data-auth-free>
          <Modal
            title="功能提示"
            width={420}
            onClose={() => setModelDevOpen(false)}
            footer={
              <button
                type="button"
                className="btn holo"
                onClick={() => setModelDevOpen(false)}
              >
                我知道了
              </button>
            }
          >
            <p className="quota-modal-text">
              当前功能正在开发中，如需更多帮助请联系万生19806651984。
            </p>
          </Modal>
        </div>
      )}
    </>
  );
}
