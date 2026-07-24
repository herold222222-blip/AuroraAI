import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { ProjectSwitcher } from './ProjectSwitcher';

type Variant = 'upload' | 'workbench';

interface TopBarProps {
  variant: Variant;
  workbenchSuffix?: string;
}

export function TopBar({ variant, workbenchSuffix }: TopBarProps) {
  const logoReset = useAppStore((s) => s.logoReset);
  const back = useAppStore((s) => s.back);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const pushToast = useAppStore((s) => s.pushToast);

  const [help, setHelp] = useState(false);
  const [login, setLogin] = useState(false);

  return (
    <header className="topbar">
      <div
        className="brand"
        onClick={logoReset}
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

      {variant === 'workbench' && (
        <>
          <div className="topbar-divider" />
          <button className="tb-btn" onClick={back}>
            ← 返回
          </button>
        </>
      )}

      <div className="topbar-center">
        {variant === 'workbench' && (
          <>
            <span className="autosave">
              <span className="dot" />
              自动保存已启用
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="tb-btn icon"
              title="撤销 (Ctrl+Z)"
              onClick={undo}
            >
              ↶
            </button>
            <button
              className="tb-btn icon"
              title="重做 (Ctrl+Y)"
              onClick={redo}
            >
              ↷
            </button>
          </>
        )}
      </div>

      <div className="topbar-right">
        <button className="tb-btn" onClick={() => setHelp(true)}>
          帮助
        </button>
        <button className="tb-btn" onClick={() => setLogin(true)}>
          登录
        </button>
      </div>

      {help && (
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
              顶部项目下拉可切换/新建项目；仅同一项目内模型截图与图片编辑互通。
            </li>
          </ol>
          <p style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 8 }}>
            提示：点击左上角 Aurora Logo 可清空当前项目并返回首页；「返回」按钮仅退回上一级并保留配置。
          </p>
        </Modal>
      )}

      {login && (
        <Modal
          title="登录 Aurora"
          subtitle="MVP 演示环境，登录仅作占位"
          width={400}
          onClose={() => setLogin(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setLogin(false)}>
                取消
              </button>
              <button
                className="btn holo"
                onClick={() => {
                  setLogin(false);
                  pushToast('演示环境已跳过登录', 'info');
                }}
              >
                登录
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">手机号 / 邮箱</label>
            <input className="input" placeholder="请输入账号" />
          </div>
          <div className="field">
            <label className="field-label">密码</label>
            <input className="input" type="password" placeholder="请输入密码" />
          </div>
        </Modal>
      )}
    </header>
  );
}
