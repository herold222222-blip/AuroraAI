import { useEffect, useRef, useState } from 'react';
import { apiGetDocs, type SiteDocs } from '../../api/authApi';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Logo } from '../common/Logo';
import { Modal } from '../common/Modal';
import { ProfileModal, UsageModal, WalletModal } from '../common/AccountModals';

const PIPELINE_NODES = [
  {
    id: 'vision',
    label: 'Vision',
    insight: '计算机视觉微内核：多视图几何、深度估计与图元级语义分割。',
  },
  {
    id: 'design',
    label: 'Design State',
    insight: '设计状态图：构件拓扑、材质绑定与空间层级的可交互中间表示。',
  },
  {
    id: 'bim',
    label: '3D BIM',
    insight: '几何参数空间：顶点、法线与 Transform 矩阵的实时可编辑模型层。',
  },
  {
    id: 'kg',
    label: 'KG Rules',
    insight: '工程知识图谱：规范约束、构造合理性与物理合规校验规则库。',
  },
] as const;

function useReveal() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll('.home-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  return rootRef;
}

export function HomePage() {
  const enterImageModule = useAppStore((s) => s.enterImageModule);
  const enterModelModule = useAppStore((s) => s.enterModelModule);
  const enterAdminModule = useAppStore((s) => s.enterAdminModule);
  const goto = useAppStore((s) => s.goto);
  const pushToast = useAppStore((s) => s.pushToast);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const user = useAuthStore((s) => s.user);
  const username = useAuthStore((s) => s.username);
  const openLogin = useAuthStore((s) => s.openLogin);
  const logout = useAuthStore((s) => s.logout);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const [contactOpen, setContactOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [helpDocs, setHelpDocs] = useState<SiteDocs | null>(null);
  const [pipelineNode, setPipelineNode] = useState<string | null>('design');
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useReveal();
  const activeInsight =
    PIPELINE_NODES.find((n) => n.id === pipelineNode)?.insight ??
    '把鼠标移到流水线节点上，可洞察核心技术微内核结构。';

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
    <>
      <main className="home" ref={rootRef} data-auth-free>
        <div className="home-topbar" data-auth-free>
          {username ? (
            <>
              <div className="topbar-user-menu home-user-menu" ref={menuRef}>
                <button
                  type="button"
                  className={`topbar-user-chip home-user-chip${
                    menuOpen ? ' open' : ''
                  }`}
                  title={user?.role === 'admin' ? '超级管理员' : '已登录'}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  data-auth-free
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
                    {!isAdmin() && (
                      <button
                        type="button"
                        role="menuitem"
                        className="topbar-user-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setWalletOpen(true);
                        }}
                      >
                        我的钱包
                      </button>
                    )}
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
                        goto('home');
                        pushToast('已退出登录', 'info');
                      }}
                    >
                      退出登陆
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="home-top-btn home-top-btn-solid"
                data-auth-free
                onClick={() => enterImageModule()}
              >
                进入 Demo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="home-top-btn home-top-btn-solid"
              data-auth-free
              onClick={openLogin}
            >
              注册 / 登录
            </button>
          )}
          <button
            type="button"
            className="home-top-btn"
            data-auth-free
            onClick={() => setContactOpen(true)}
          >
            联系我们
          </button>
        </div>

        <section className="home-hero">
          <div
            className="home-hero-bg"
            style={{ backgroundImage: "url('/examples/example-2.jpg')" }}
            aria-hidden
          />
          <div className="home-hero-veil" aria-hidden />
          <div className="home-hero-inner">
            <div className="home-brand home-hero-enter">
              <Logo size={42} />
              <span className="home-brand-name">Aurora</span>
            </div>
            <p className="home-company home-hero-enter home-hero-enter-d1">
              灵曦万象人工智能 · Gnoverse AI Tech
            </p>
            <h1 className="home-hero-tagline home-hero-enter home-hero-enter-d2">
              新一代的工程设计超级智能体
            </h1>
            <p className="home-hero-lead home-hero-enter home-hero-enter-d3">
              将多元设计数据统一为3D工程信息模型，并实现数据的多向同步，AI辅助快速生成精准、可编辑的设计成果。
            </p>
            <ul className="home-scene-cards home-hero-enter home-hero-enter-d4">
              <li>
                <strong>建筑设计</strong>
                <span>体量 · 构件 · 工艺语义</span>
              </li>
              <li>
                <strong>景观设计</strong>
                <span>地形 · 植被 · 场所尺度</span>
              </li>
              <li>
                <strong>室内设计</strong>
                <span>材料 · 空间 · 细部表达</span>
              </li>
            </ul>
            <div className="home-hero-cta home-hero-enter home-hero-enter-d5">
              <button
                type="button"
                className="home-cta"
                data-auth-free
                onClick={() => enterImageModule()}
              >
                立即体验 Demo
              </button>
            </div>
          </div>
        </section>

        <section className="home-section home-capability home-reveal">
          <div
            className="home-capability-media"
            style={{ backgroundImage: "url('/examples/example-1.jpg')" }}
            role="img"
            aria-label="AI 图生模型示意"
          />
          <div className="home-capability-copy">
            <p className="home-kicker">Capability</p>
            <h2 className="home-h2">AI 图生模型</h2>
            <p className="home-p">
              上传建筑、景观或室内效果图，自动完成专业图层拆分与高精度、可编辑的
              3D 场景构建，缩短从概念方案到三维深化的路径。
            </p>
            <button
              type="button"
              className="home-cta home-cta-ghost"
              data-auth-free
              onClick={() => enterModelModule()}
            >
              进入图生模型
            </button>
          </div>
        </section>

        <section className="home-section home-capability home-capability-flip home-reveal">
          <div
            className="home-capability-media"
            style={{ backgroundImage: "url('/examples/example-3.jpg')" }}
            role="img"
            aria-label="AI 改图工具示意"
          />
          <div className="home-capability-copy">
            <p className="home-kicker">Capability</p>
            <h2 className="home-h2">AI 改图工具</h2>
            <p className="home-p">
              支持全局与局部智能修图：素描标记、涂抹区域与参考材质协同，在保留场景几何与光感的前提下快速迭代视觉成果。
            </p>
            <button
              type="button"
              className="home-cta home-cta-ghost"
              data-auth-free
              onClick={() => enterImageModule()}
            >
              进入改图工具
            </button>
          </div>
        </section>

        <section className="home-section home-foundations home-reveal">
          <div className="home-foundations-head">
            <div>
              <p className="home-kicker">03 / 技术壁垒 · Core Capabilities</p>
              <h2 className="home-h2">奠定行业下一代智能设计的技术基石</h2>
            </div>
            <p className="home-p home-foundations-lead">
              Aurora Agent
              融合了计算机视觉、计算图形学、多模态语言模型、机械建筑结构约束等跨学科前沿技术，建立不可替代的物理级设计理解壁垒。
            </p>
          </div>

          <div className="home-foundation-grid">
            <article className="home-foundation-item">
              <div className="home-foundation-top">
                <span className="home-foundation-en">Visual Understanding</span>
                <span className="home-foundation-num">01</span>
              </div>
              <h3 className="home-foundation-title">视觉理解能力</h3>
              <p className="home-foundation-desc">
                能够从单张或多张平面效果图中，高精度反推场景的空间比例与相机内外参，实现像素级元素解耦。
              </p>
              <p className="home-foundation-label">Core Features</p>
              <ul className="home-foundation-features">
                <li>图片特征极速分割与解析</li>
                <li>相机透视畸变及镜头参数恢复</li>
                <li>多视点联合三维重构与深度估计</li>
                <li>设计图元（墙体、铺装、植被）分类识别</li>
              </ul>
            </article>

            <article className="home-foundation-item">
              <div className="home-foundation-top">
                <span className="home-foundation-en">Scene Intelligence</span>
                <span className="home-foundation-num">02</span>
              </div>
              <h3 className="home-foundation-title">设计状态理解</h3>
              <p className="home-foundation-desc">
                超越浅层视觉生成。AI
                理解的是具有物理意义的构件拓扑关联，支持对具体「节点模型」进行属性溯源与交互。
              </p>
              <p className="home-foundation-label">Core Features</p>
              <ul className="home-foundation-features">
                <li>空间拓扑结构语义关系建模</li>
                <li>建筑构件与周边环境约束提取</li>
                <li>材质纹理光影与深度信息绑定</li>
                <li>空间层级（软装/硬装/基础）自动划分</li>
              </ul>
            </article>

            <article className="home-foundation-item">
              <div className="home-foundation-top">
                <span className="home-foundation-en">Model Synchronization</span>
                <span className="home-foundation-num">03</span>
              </div>
              <h3 className="home-foundation-title">双向模型同步</h3>
              <p className="home-foundation-desc">
                建立图像空间到几何参数空间的双向实时射影映射，实现改词、改图即可直接自动变形
                CAD/BIM 底层几何模型。
              </p>
              <p className="home-foundation-label">Core Features</p>
              <ul className="home-foundation-features">
                <li>自然语言驱动的参数化变形修改</li>
                <li>三维线框网格顶点与法线快速更新</li>
                <li>FBX / OBJ / IFC 等多标准格式支持</li>
                <li>双向 CAD/BIM 模型参数热重载同步</li>
              </ul>
            </article>

            <article className="home-foundation-item">
              <div className="home-foundation-top">
                <span className="home-foundation-en">Construction Intelligence</span>
                <span className="home-foundation-num">04</span>
              </div>
              <h3 className="home-foundation-title">工程知识智能</h3>
              <p className="home-foundation-desc">
                融入行业特有 Know-how。保证 AI
                调整过的设计尺寸均满足真实建筑、市政、景观规范，拒绝反物理的 AI
                幻想图。
              </p>
              <p className="home-foundation-label">Core Features</p>
              <ul className="home-foundation-features">
                <li>国家建筑与景观材料合规规范预校</li>
                <li>构造节点连接合理性自动纠错</li>
                <li>真实世界工程造价与施工难度估算</li>
                <li>物理材料力学结构承载安全度评估</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="home-section home-infra home-reveal">
          <p className="home-kicker">04 / 空间大模型 · Infrastructure</p>
          <h2 className="home-h2">多领域融合的空间大模型基础设施</h2>
          <p className="home-p home-infra-intro">
            Aurora Agent 通过计算机视觉 (CV)、图形几何算法 (CG)、多模态理解与工程知识图谱
            (KG) 的底层融合，实现从静态平面图像到可编辑施工世界的完整映射。
          </p>

          <div className="home-infra-grid">
            <div className="home-pipeline">
              <p className="home-pipeline-label">
                Aurora Deep Integration Pipeline
              </p>
              <div className="home-pipeline-core">Aurora AI Agent Core</div>
              <div className="home-pipeline-nodes" role="list">
                {PIPELINE_NODES.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    role="listitem"
                    className={`home-pipeline-node${
                      pipelineNode === node.id ? ' active' : ''
                    }`}
                    data-auth-free
                    onMouseEnter={() => setPipelineNode(node.id)}
                    onFocus={() => setPipelineNode(node.id)}
                    onClick={() => setPipelineNode(node.id)}
                  >
                    {node.label}
                  </button>
                ))}
              </div>
              <p className="home-pipeline-hint">{activeInsight}</p>
            </div>

            <div className="home-infra-copy">
              <h3 className="home-infra-subtitle">打通图像与物理大门</h3>
              <p className="home-p">
                传统 AI
                绘图在像素空间随机采样，一改就丢物理几何关系。Aurora
                的核心突破是引入「Design State」中间图：解析效果图时不只保留色彩，而是重建三维点云与几何法线。
              </p>
              <p className="home-p">
                自然语言指令会被转译为精确的 Transform
                矩阵，直接驱动 CAD/BIM
                顶点变形，确保工业标准下的连续性与物理合规。
              </p>
              <div className="home-infra-badge">
                <strong>100% 工业级精准控制</strong>
                <span>
                  模型高度误差控制在 ±20mm
                  内，材质排版铺贴符合国际 BIM Level 3 标准。
                </span>
              </div>
            </div>
          </div>
        </section>

        <footer className="home-footer">
          <span className="home-footer-brand">Aurora</span>
          <span className="home-footer-co">
            灵曦万象人工智能（Gnoverse AI Tech）
          </span>
        </footer>
      </main>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {usageOpen && <UsageModal onClose={() => setUsageOpen(false)} />}
      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}

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

      {contactOpen && (
        <div data-auth-free>
          <Modal
            title="联系我们"
            width={420}
            onClose={() => setContactOpen(false)}
            footer={
              <button
                type="button"
                className="btn holo"
                onClick={() => setContactOpen(false)}
              >
                我知道了
              </button>
            }
          >
            <p className="quota-modal-text">
              联系电话：19806651984
              <br />
              联系人：万生
            </p>
          </Modal>
        </div>
      )}

    </>
  );
}
