import { useEffect, useRef, useState } from 'react';
import { apiGetDocs, type SiteDocs } from '../../api/authApi';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { ProjectSwitcher } from './ProjectSwitcher';
import { DonatePage } from './DonatePage';
import { ProfileModal, UsageModal } from './AccountModals';

type Variant = 'upload' | 'workbench';

interface TopBarProps {
  variant: Variant;
  workbenchSuffix?: string;
}

export function TopBar({ variant, workbenchSuffix }: TopBarProps) {
  const pushToast = useAppStore((s) => s.pushToast);
  const enterAdminModule = useAppStore((s) => s.enterAdminModule);
  const goto = useAppStore((s) => s.goto);

  const user = useAuthStore((s) => s.user);
  const username = useAuthStore((s) => s.username);
  const openLogin = useAuthStore((s) => s.openLogin);
  const logout = useAuthStore((s) => s.logout);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [help, setHelp] = useState(false);
  const [helpDocs, setHelpDocs] = useState<SiteDocs | null>(null);
  const [donate, setDonate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!help) return;
    void apiGetDocs()
      .then((r) => setHelpDocs(r.docs))
      .catch(() => setHelpDocs(null));
  }, [help]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!username) setMenuOpen(false);
  }, [username]);

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">
          <b>Aurora</b>
        </span>
        <span className="brand-powered">powered by 灵曦万象人工智能</span>
      </div>

      <div className="topbar-divider" />
      <span className="project-switcher-label">项目名</span>
      <ProjectSwitcher />
      {workbenchSuffix && (
        <span className="project-name-suffix"> · {workbenchSuffix}</span>
      )}

      <div className="topbar-center">
        {variant === 'workbench' && (
          <span className="autosave">
            <span className="dot" />
            自动保存已启用
          </span>
        )}
      </div>

      <div className="topbar-right" data-auth-free>
        <button
          type="button"
          className="tb-btn tb-btn-donate"
          onClick={() => setDonate(true)}
        >
          赞赏我们
        </button>
        {username ? (
          <div className="topbar-user-menu" ref={menuRef}>
            <button
              type="button"
              className={`topbar-user-chip${menuOpen ? ' open' : ''}`}
              title={user?.role === 'admin' ? '超级管理员' : '已登录'}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <img
                className="topbar-avatar"
                src={user?.avatar || '/avatars/default-1.svg'}
                alt=""
              />
              <span className="topbar-user">{username}</span>
              <span className="topbar-user-caret" aria-hidden>
                ▾
              </span>
            </button>
            {menuOpen && (
              <div className="topbar-user-dropdown" role="menu">
                {isAdmin() && (
                  <button
                    type="button"
                    role="menuitem"
                    className="topbar-user-item"
                    onClick={() => {
                      setMenuOpen(false);
                      if (!requireAuth()) return;
                      enterAdminModule();
                    }}
                  >
                    工作台
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="topbar-user-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  修改个人信息
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="topbar-user-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setUsageOpen(true);
                  }}
                >
                  查看用量
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="topbar-user-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setHelpDocs(null);
                    setHelp(true);
                  }}
                >
                  帮助
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="topbar-user-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                    goto('upload');
                    pushToast('已退出登录', 'info');
                  }}
                >
                  退出登陆
                </button>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="tb-btn" onClick={openLogin}>
            登录 / 注册
          </button>
        )}
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {usageOpen && <UsageModal onClose={() => setUsageOpen(false)} />}

      {help && (
        <div data-auth-free>
          <Modal
            title={helpDocs?.helpTitle || '帮助中心'}
            subtitle={helpDocs?.helpSubtitle || 'Aurora 使用流程'}
            onClose={() => setHelp(false)}
          >
            {helpDocs ? (
              <pre className="doc-body">{helpDocs.helpBody}</pre>
            ) : (
              <p className="doc-loading">加载中…</p>
            )}
          </Modal>
        </div>
      )}

      {donate && <DonatePage onClose={() => setDonate(false)} />}
    </header>
  );
}
