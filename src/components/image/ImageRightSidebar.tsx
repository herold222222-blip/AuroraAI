import { useRef, useState } from 'react';
import { InlineRename } from '../common/InlineRename';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';

export function ImageRightSidebar() {
  const snapshots = useAppStore((s) => s.snapshots);
  const renameSnapshot = useAppStore((s) => s.renameSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const updateSnapshotUrl = useAppStore((s) => s.updateSnapshotUrl);
  const pushToast = useAppStore((s) => s.pushToast);

  const sidebarTab = useImageStore((s) => s.sidebarTab);
  const setSidebarTab = useImageStore((s) => s.setSidebarTab);
  const savedImages = useImageStore((s) => s.savedImages);
  const openFromUrl = useImageStore((s) => s.openFromUrl);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const sourceSnapshotId = useImageStore((s) => s.sourceSnapshotId);
  const saveAsNew = useImageStore((s) => s.saveAsNew);
  const overwriteSnapshot = useImageStore((s) => s.overwriteSnapshot);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="panel right img-right-sidebar">
      <div className="img-side-tabs">
        <button
          type="button"
          className={sidebarTab === 'snapshots' ? 'active' : ''}
          onClick={() => setSidebarTab('snapshots')}
        >
          模型截图
          <span>{snapshots.length}</span>
        </button>
        <button
          type="button"
          className={sidebarTab === 'saved' ? 'active' : ''}
          onClick={() => setSidebarTab('saved')}
        >
          另存图片
          <span>{savedImages.length}</span>
        </button>
      </div>

      {currentUrl && (
        <div className="img-side-actions">
          <button
            type="button"
            className="btn ghost sm"
            disabled={!sourceSnapshotId}
            title={
              sourceSnapshotId
                ? '用当前结果覆盖来源模型截图'
                : '当前图不是从截图打开的'
            }
            onClick={() => {
              const ok = overwriteSnapshot(updateSnapshotUrl);
              if (!ok) pushToast('无法覆盖：未关联模型截图', 'info');
            }}
          >
            覆盖原图
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              saveAsNew();
              pushToast('已另存到侧栏', 'success');
            }}
          >
            另存
          </button>
        </div>
      )}

      <div className="panel-scroll img-side-scroll">
        {sidebarTab === 'snapshots' ? (
          <>
            <p className="img-side-hint">
              与模型相机模式数据互通。点击缩略图载入编辑。
            </p>
            <div className="img-side-grid">
              {snapshots.length === 0 && (
                <div className="empty">暂无模型截图，请在 3D 相机模式添加</div>
              )}
              {snapshots.map((s) => (
                <div key={s.id} className="img-side-card">
                  <button
                    type="button"
                    className="img-side-thumb"
                    onClick={() => openFromUrl(s.url, { snapshotId: s.id })}
                  >
                    <img src={s.url} alt={s.label} />
                  </button>
                  <div className="img-side-label">
                    <InlineRename
                      value={s.label}
                      onChange={(name) => renameSnapshot(s.id, name)}
                    />
                  </div>
                  <button
                    type="button"
                    className="camera-snap-delete"
                    title="删除"
                    onClick={() => setConfirmId(s.id)}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="img-side-hint">改图后另存的图片保存在此。</p>
            <div className="img-side-grid">
              {savedImages.length === 0 && (
                <div className="empty">暂无另存图片</div>
              )}
              {savedImages.map((s) => (
                <div key={s.id} className="img-side-card">
                  <button
                    type="button"
                    className="img-side-thumb"
                    onClick={() => openFromUrl(s.url)}
                  >
                    <img src={s.url} alt={s.label} />
                  </button>
                  <div className="img-side-label">{s.label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => openFromUrl(String(reader.result));
            reader.readAsDataURL(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn ghost block"
          style={{ marginTop: 12 }}
          onClick={() => fileRef.current?.click()}
        >
          上传本地图片
        </button>
      </div>

      {confirmId && (
        <div className="camera-confirm-mask" role="dialog">
          <div className="camera-confirm">
            <p>确定删除该模型截图？</p>
            <div className="camera-confirm-actions">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setConfirmId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger sm"
                onClick={() => {
                  removeSnapshot(confirmId);
                  setConfirmId(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
