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
  const mobileAlbumOpen = useImageStore((s) => s.mobileAlbumOpen);
  const setMobileAlbumOpen = useImageStore((s) => s.setMobileAlbumOpen);

  return (
    <div className={`app img-workbench${!currentUrl ? ' is-start' : ''}`}>
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
              <div className="img-editor-tools">
                <RetouchToolbar />
                <MaterialDrawer />
              </div>
              <ImageCanvasStage />
            </div>
            <ImageBottomControls />
            <ImageFooterBar />
          </>
        )}
      </div>
      {currentUrl ? (
        <>
          {mobileAlbumOpen && (
            <button
              type="button"
              className="img-album-backdrop"
              aria-label="关闭原图列表"
              onClick={() => setMobileAlbumOpen(false)}
            />
          )}
          <ImageRightSidebar />
        </>
      ) : null}
    </div>
  );
}
