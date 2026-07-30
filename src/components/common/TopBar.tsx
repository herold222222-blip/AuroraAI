import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { ProjectSwitcher } from './ProjectSwitcher';
import { DonatePage } from './DonatePage';

type Variant = 'upload' | 'workbench';

interface TopBarProps {
  variant: Variant;
  workbenchSuffix?: string;
}

export function TopBar({ variant, workbenchSuffix }: TopBarProps) {
  const logoReset = useAppStore((s) => s.logoReset);
  const pushToast = useAppStore((s) => s.pushToast);

  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const logout = useAuthStore((s) => s.logout);
  const requireAuth = useAuthStore((s) => s.requireAuth);

  const [help, setHelp] = useState(false);
  const [donate, setDonate] = useState(false);

  return (
    <header className="topbar">
      <div
        className="brand"
        onClick={() => {
          if (!requireAuth()) return;
          logoReset();
        }}
        title="点击 Logo 清空当前项目数据并返回上传首页"
      >
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
        <button type="button" className="tb-btn" onClick={() => setHelp(true)}>
          帮助
        </button>
        {user ? (
          <>
            <span className="topbar-user" title="已登录">
              {user}
            </span>
            <button
              type="button"
              className="tb-btn"
              onClick={() => {
                logout();
                pushToast('已退出登录', 'info');
              }}
            >
              退出
            </button>
          </>
        ) : (
          <button type="button" className="tb-btn" onClick={openLogin}>
            登录
          </button>
        )}
      </div>

      {help && (
        <div data-auth-free>
          <Modal
            title="帮助中心"
            subtitle="Aurora 使用流程"
            onClose={() => setHelp(false)}
          >
            <ol
              style={{
                paddingLeft: 18,
                lineHeight: 1.9,
                color: 'var(--ink-soft)',
                fontSize: 14,
              }}
            >
              <li>上传一张 2D 景观意向图（支持 JPG / PNG / WEBP）。</li>
              <li>
                点击「⚡分析场景图层」，AI 自动拆分地形、植被、水体、构筑物等专业图层。
              </li>
              <li>在 2D 智能色块工作台调整图层，发起 3D 模型生成。</li>
              <li>
                在 3D 工作台执行拆分 / 合并 / 材质编辑，最终导出或同步至设计软件。
              </li>
              <li>
                默认进入「未立项空间」。可用顶部下拉「新立项」保存当前工作；也可随时切回未立项空间或其它项目。
              </li>
              <li>
                在未立项空间中，从模型同步到效果图，或从改图生成三维时，会弹框确认自动立项。
              </li>
              <li>
                仅同一项目内模型截图与图片编辑互通。
              </li>
              <li>
                Demo 演示版：访客可浏览页面；使用功能需登录。如需获取访问权限，联系万生
                19806651984（暂不开放注册）。
              </li>
            </ol>
            <p style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 8 }}>
              提示：点击左上角 Aurora Logo 可清空当前项目并返回首页。
            </p>
          </Modal>
        </div>
      )}

      {donate && <DonatePage onClose={() => setDonate(false)} />}
    </header>
  );
}
