import { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { UploadPage } from './components/pages/UploadPage';
import { AnalysisTransition } from './components/pages/AnalysisTransition';
import { Workbench2D } from './components/pages/Workbench2D';
import { BuildTransition } from './components/pages/BuildTransition';
import { Workbench3D } from './components/pages/Workbench3D';
import { ImageWorkbench } from './components/pages/ImageWorkbench';
import { Toasts } from './components/common/Toasts';
import { AppSidebar } from './components/common/AppSidebar';
import { TopBar } from './components/common/TopBar';
import { AuthGuard } from './components/common/AuthGuard';
import { LoginModal } from './components/common/LoginModal';
import { ProjectPromoteModal } from './components/common/ProjectPromoteModal';
import { ImageDownloadProvider } from './components/common/ImageDownloadContext';
import { useAuthStore } from './store/useAuthStore';

function RouteProgress({ view }: { view: string }) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    setVisible(true);
    setWidth(12);
    const t1 = setTimeout(() => setWidth(80), 60);
    const t2 = setTimeout(() => setWidth(100), 320);
    const t3 = setTimeout(() => setVisible(false), 620);
    const t4 = setTimeout(() => setWidth(0), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [view]);

  if (!visible) return null;
  return <div className="route-progress" style={{ width: `${width}%` }} />;
}

export default function App() {
  const view = useAppStore((s) => s.view);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const requireAuth = useAuthStore((s) => s.requireAuth);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (!requireAuth()) return;
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (!requireAuth()) return;
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, requireAuth]);

  const topBar =
    view === 'image' ? (
      <TopBar variant="workbench" workbenchSuffix="AI 图像编辑" />
    ) : view === 'workbench2d' ? (
      <TopBar variant="workbench" workbenchSuffix="2D 色块工作台" />
    ) : view === 'workbench3d' ? (
      <TopBar variant="workbench" workbenchSuffix="3D 编辑工作台" />
    ) : view === 'analysis' ? (
      <TopBar variant="workbench" workbenchSuffix="场景分析" />
    ) : view === 'build' ? (
      <TopBar variant="workbench" workbenchSuffix="三维构建" />
    ) : (
      <TopBar variant="workbench" workbenchSuffix="图生模型" />
    );

  return (
    <ImageDownloadProvider>
      <div className="app-shell">
        <AuthGuard />
        <LoginModal />
        <ProjectPromoteModal />
        {topBar}
        <div className="app-body">
          <AppSidebar />
          <div className="app-main">
            <RouteProgress view={view} />
            {view === 'upload' && <UploadPage />}
            {view === 'analysis' && <AnalysisTransition />}
            {view === 'workbench2d' && <Workbench2D />}
            {view === 'build' && <BuildTransition />}
            {view === 'workbench3d' && <Workbench3D />}
            {view === 'image' && <ImageWorkbench />}
            <Toasts />
          </div>
        </div>
      </div>
    </ImageDownloadProvider>
  );
}
