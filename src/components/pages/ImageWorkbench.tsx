import { ImageStartScreen, ImageModeBadge } from '../image/ImageStartScreen';
import { ImageCanvasStage } from '../image/ImageCanvasStage';
import { RetouchToolbar } from '../image/RetouchToolbar';
import { MaterialDrawer } from '../image/MaterialDrawer';
import { ImageBottomControls } from '../image/ImageBottomControls';
import { ImageFooterBar } from '../image/ImageFooterBar';
import { ImageRightSidebar } from '../image/ImageRightSidebar';
import { useImageStore } from '../../image/useImageStore';

export function ImageWorkbench() {
  const currentUrl = useImageStore((s) => s.currentUrl);
  const busy = useImageStore((s) => s.busy);

  return (
    <div className="app img-workbench">
      <div className="img-main-col">
        {!currentUrl ? (
          <ImageStartScreen />
        ) : (
          <>
            <div className="img-editor-top">
              <ImageModeBadge />
              {busy && <span className="img-busy-pill">AI 处理中…</span>}
            </div>
            <div className="img-editor-body">
              <RetouchToolbar />
              <ImageCanvasStage />
              <MaterialDrawer />
            </div>
            <ImageBottomControls />
            <ImageFooterBar />
          </>
        )}
      </div>
      <ImageRightSidebar />
    </div>
  );
}
