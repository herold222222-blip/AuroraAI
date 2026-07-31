import { useEffect, useMemo, useRef, useState } from 'react';
import { InlineRename } from '../common/InlineRename';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore, repairImageLabel } from '../../image/useImageStore';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import { downloadImages } from '../../utils/downloadImage';
import { formatDateTime } from '../../utils/formatDateTime';
import { ImageTo3DButton } from './ImageTo3DButton';

const ORIGINAL_SELECT_ID = '__original__';

export function ImageRightSidebar() {
  const updateSnapshotUrl = useAppStore((s) => s.updateSnapshotUrl);
  const pushToast = useAppStore((s) => s.pushToast);
  const openDownloadMenu = useImageDownloadMenu();

  const focusOriginal = useImageStore((s) => s.focusOriginal);
  const focusSavedResult = useImageStore((s) => s.focusSavedResult);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const originalUrl = useImageStore((s) => s.originalUrl);
  const sourceSnapshotId = useImageStore((s) => s.sourceSnapshotId);
  const savedImages = useImageStore((s) => s.savedImages);
  const sourceAlbums = useImageStore((s) => s.sourceAlbums);
  const activeSourceId = useImageStore((s) => s.activeSourceId);
  const sourceSidebarMode = useImageStore((s) => s.sourceSidebarMode);
  const openSourceAlbum = useImageStore((s) => s.openSourceAlbum);
  const backToSourceList = useImageStore((s) => s.backToSourceList);
  const renameSourceAlbum = useImageStore((s) => s.renameSourceAlbum);
  const removeSourceAlbum = useImageStore((s) => s.removeSourceAlbum);
  const renameSavedImage = useImageStore((s) => s.renameSavedImage);
  const removeSavedImage = useImageStore((s) => s.removeSavedImage);
  const setResultAsOriginal = useImageStore((s) => s.setResultAsOriginal);
  const overwriteOriginalWithResult = useImageStore(
    (s) => s.overwriteOriginalWithResult,
  );
  const overwriteSnapshot = useImageStore((s) => s.overwriteSnapshot);
  const openFromUrl = useImageStore((s) => s.openFromUrl);

  // Heal labels corrupted by a past non-UTF8 write (`??? 1` → `结果 1`).
  useEffect(() => {
    const state = useImageStore.getState();
    let dirty = false;
    const savedImages = state.savedImages.map((x) => {
      const label = repairImageLabel(x.label, 'result');
      if (label !== x.label) dirty = true;
      return label === x.label ? x : { ...x, label };
    });
    const sourceAlbums = state.sourceAlbums.map((a) => {
      const label = repairImageLabel(a.label, 'album');
      const results = a.results.map((r) => {
        const rl = repairImageLabel(r.label, 'result');
        if (rl !== r.label) dirty = true;
        return rl === r.label ? r : { ...r, label: rl };
      });
      if (label !== a.label) dirty = true;
      return label === a.label && results === a.results
        ? a
        : { ...a, label, results };
    });
    if (dirty) {
      useImageStore.setState({ savedImages, sourceAlbums });
    }
  }, []);

  const [confirmAlbumId, setConfirmAlbumId] = useState<string | null>(null);
  const [confirmResultId, setConfirmResultId] = useState<string | null>(null);
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
  const [resultViewMode, setResultViewMode] = useState<'large' | 'list'>(
    'large',
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const lastClickedIdRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeAlbum = sourceAlbums.find((a) => a.id === activeSourceId);
  const fromSnapshot =
    Boolean(sourceSnapshotId) || Boolean(activeAlbum?.sourceSnapshotId);
  const inAlbumDetail = sourceSidebarMode === 'detail';
  const inAlbumList = sourceSidebarMode === 'list';

  const modeKey = inAlbumDetail
    ? `detail:${activeSourceId ?? ''}`
    : 'albums';

  useEffect(() => {
    setSelectedIds([]);
    lastClickedIdRef.current = null;
  }, [modeKey]);

  const selectableIds = useMemo(() => {
    if (inAlbumList) return sourceAlbums.map((a) => a.id);
    const ids: string[] = [];
    if (originalUrl) ids.push(ORIGINAL_SELECT_ID);
    ids.push(...[...savedImages].reverse().map((s) => s.id));
    return ids;
  }, [inAlbumList, sourceAlbums, originalUrl, savedImages]);

  const listTitle = fromSnapshot || sourceAlbums.some((a) => a.sourceSnapshotId)
    ? '快照列表'
    : '原图列表';
  const headTitle = inAlbumDetail
    ? fromSnapshot
      ? '当前快照'
      : '当前原图'
    : listTitle;
  const headCount = inAlbumDetail
    ? 1 + savedImages.length
    : sourceAlbums.length;
  const backLabel = fromSnapshot || sourceAlbums.some((a) => a.sourceSnapshotId)
    ? '← 返回快照列表'
    : '← 返回原图列表';

  const uploadFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    list.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        openFromUrl(String(reader.result), {
          label:
            f.name.replace(/\.[^.]+$/, '') ||
            `原图 ${sourceAlbums.length + i + 1}`,
        });
      };
      reader.readAsDataURL(f);
    });
  };

  const toggleSelect = (id: string, opts?: { range?: boolean }) => {
    setSelectedIds((prev) => {
      if (opts?.range && lastClickedIdRef.current) {
        const a = selectableIds.indexOf(lastClickedIdRef.current);
        const b = selectableIds.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const rangeIds = selectableIds.slice(lo, hi + 1);
          return [...new Set([...prev, ...rangeIds])];
        }
      }
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
    lastClickedIdRef.current = id;
  };

  const selectAll = () => setSelectedIds(selectableIds);
  const clearSelection = () => setSelectedIds([]);

  const resolveDownloadItems = () => {
    if (inAlbumList) {
      return selectedIds
        .map((id) => sourceAlbums.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => ({ url: a.url, filename: a.label }));
    }
    const items: { url: string; filename: string }[] = [];
    for (const id of selectedIds) {
      if (id === ORIGINAL_SELECT_ID && originalUrl) {
        const label = activeAlbum?.label || (fromSnapshot ? '快照' : '原图');
        items.push({ url: originalUrl, filename: label });
      } else {
        const s = savedImages.find((x) => x.id === id);
        if (s) items.push({ url: s.url, filename: s.label });
      }
    }
    return items;
  };

  const onDownloadSelected = () => {
    if (!selectedIds.length) {
      pushToast('请先选择至少一张图片', 'info');
      return;
    }
    const items = resolveDownloadItems();
    void (async () => {
      const n = await downloadImages(items);
      if (n > 0) pushToast(`已开始下载 ${n} 张`, 'success');
      else pushToast('下载失败', 'error');
    })();
  };

  const bulkDeletableIds = useMemo(() => {
    if (inAlbumList) return selectedIds;
    return selectedIds.filter((id) => id !== ORIGINAL_SELECT_ID);
  }, [inAlbumList, selectedIds]);

  const onRequestBulkDelete = () => {
    if (!selectedIds.length) {
      pushToast('请先选择至少一张图片', 'info');
      return;
    }
    if (!bulkDeletableIds.length) {
      pushToast(
        inAlbumDetail
          ? '当前原图不可在此删除，请返回列表删除整张原图'
          : '没有可删除的项',
        'info',
      );
      return;
    }
    setConfirmBulkIds([...bulkDeletableIds]);
  };

  const onConfirmBulkDelete = () => {
    const ids = confirmBulkIds ?? [];
    if (!ids.length) {
      setConfirmBulkIds(null);
      return;
    }
    if (inAlbumList) {
      ids.forEach((id) => removeSourceAlbum(id));
      pushToast(
        ids.length === 1 ? '已删除原图' : `已删除 ${ids.length} 张原图`,
        'success',
      );
    } else {
      ids.forEach((id) => removeSavedImage(id));
      pushToast(
        ids.length === 1
          ? '已删除生成结果'
          : `已删除 ${ids.length} 个生成结果`,
        'success',
      );
    }
    setSelectedIds([]);
    lastClickedIdRef.current = null;
    setConfirmBulkIds(null);
  };

  const showSelectBar = selectableIds.length > 0;

  const checkBtn = (id: string) => {
    const on = selectedIds.includes(id);
    return (
      <button
        type="button"
        className={`camera-snap-check${on ? ' on' : ''}`}
        title={on ? '取消选择' : '选择'}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(id, { range: e.shiftKey });
        }}
      >
        {on ? '✓' : ''}
      </button>
    );
  };

  return (
    <aside className="panel right img-right-sidebar">
      <div className="img-side-head">
        <div className="img-side-head-title">
          <span>{headTitle}</span>
          <span className="img-side-count">{headCount}</span>
        </div>
        {inAlbumDetail && (
          <button
            type="button"
            className="btn ghost sm img-side-back"
            onClick={() => {
              backToSourceList();
              pushToast(
                fromSnapshot || sourceAlbums.some((a) => a.sourceSnapshotId)
                  ? '已返回快照列表'
                  : '已返回原图列表',
                'info',
              );
            }}
          >
            {backLabel}
          </button>
        )}
      </div>

      {inAlbumDetail && originalUrl && (
        <div className="img-side-original img-side-original-pin">
          <div
            className={`img-side-card img-side-card-original${
              currentUrl === originalUrl ? ' is-active' : ''
            }${
              selectedIds.includes(ORIGINAL_SELECT_ID) ? ' is-selected' : ''
            }`}
          >
            {checkBtn(ORIGINAL_SELECT_ID)}
            <button
              type="button"
              className="img-side-thumb"
              title="载入原图"
              onClick={() => focusOriginal()}
              onContextMenu={(e) =>
                openDownloadMenu(
                  e,
                  originalUrl,
                  activeAlbum?.label || '原图',
                )
              }
            >
              <img src={originalUrl} alt="原图" />
            </button>
            <div className="img-side-label">
              {activeAlbum
                ? repairImageLabel(activeAlbum.label, 'album')
                : fromSnapshot
                  ? '快照'
                  : '原图'}
            </div>
          </div>
          {activeAlbum && activeAlbum.createdAt > 0 && (
            <div className="img-side-meta-row">
              <span className="img-side-meta-label">
                {fromSnapshot ? '导入时间' : '上传时间'}
              </span>
              <span className="img-side-result-time" title="时间">
                {formatDateTime(activeAlbum.createdAt)}
              </span>
            </div>
          )}
        </div>
      )}

      {(fromSnapshot && currentUrl) || showSelectBar ? (
        <div className="img-side-toolbar">
          {fromSnapshot && currentUrl && (
            <div className="img-side-actions">
              <button
                type="button"
                className="btn ghost sm"
                title="用当前结果覆盖来源模型截图"
                onClick={() => {
                  const ok = overwriteSnapshot(updateSnapshotUrl);
                  if (!ok) pushToast('无法覆盖：未关联模型截图', 'info');
                  else pushToast('已覆盖模型截图', 'success');
                }}
              >
                覆盖原图
              </button>
            </div>
          )}
          {showSelectBar && (
            <div className="camera-panel-select-bar img-side-select-bar">
              <button type="button" className="btn ghost sm" onClick={selectAll}>
                全选
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={!selectedIds.length}
                onClick={clearSelection}
              >
                清空
              </button>
              <span className="camera-panel-select-count">
                已选 {selectedIds.length}
              </span>
              <button
                type="button"
                className="btn holo sm"
                disabled={!selectedIds.length}
                onClick={onDownloadSelected}
              >
                下载
                {selectedIds.length > 0 ? `（${selectedIds.length}）` : ''}
              </button>
              <button
                type="button"
                className="btn danger sm"
                disabled={!selectedIds.length}
                title={
                  inAlbumList
                    ? '删除选中的原图及其生成结果'
                    : '删除选中的生成结果'
                }
                onClick={onRequestBulkDelete}
              >
                删除
                {bulkDeletableIds.length > 0
                  ? `（${bulkDeletableIds.length}）`
                  : ''}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="panel-scroll img-side-scroll">
        {inAlbumList ? (
          <>
            <p className="img-side-hint">
              {fromSnapshot || sourceAlbums.some((a) => a.sourceSnapshotId)
                ? '点击快照进入编辑；下方可查看该快照的历史生成结果。'
                : '上传的原图会集中在此。点击某张进入编辑：原图置顶，下方为该图的生成结果。'}
            </p>
            <div className="img-side-album-list">
              {sourceAlbums.length === 0 && (
                <div className="empty">暂无原图，请先上传</div>
              )}
              {sourceAlbums.map((a) => (
                <div
                  key={a.id}
                  className={`img-side-album-card${
                    currentUrl === a.url || originalUrl === a.url
                      ? ' is-active'
                      : ''
                  }${selectedIds.includes(a.id) ? ' is-selected' : ''}`}
                >
                  {checkBtn(a.id)}
                  <button
                    type="button"
                    className="img-side-album-thumb"
                    onClick={() => openSourceAlbum(a.id)}
                    title="进入该原图"
                    onContextMenu={(e) => openDownloadMenu(e, a.url, a.label)}
                  >
                    <img src={a.url} alt={a.label} />
                  </button>
                  <div className="img-side-album-caption">
                    <div className="img-side-meta-row">
                      <InlineRename
                        value={repairImageLabel(a.label, 'album')}
                        onChange={(name) => renameSourceAlbum(a.id, name)}
                      />
                      {a.createdAt > 0 && (
                        <span className="img-side-result-time" title="时间">
                          {formatDateTime(a.createdAt)}
                        </span>
                      )}
                    </div>
                    <span className="img-side-album-sub">
                      {a.sourceSnapshotId ? '模型快照 · ' : ''}
                      {a.results.length} 个生成结果
                    </span>
                  </div>
                  <button
                    type="button"
                    className="camera-snap-delete"
                    title="删除"
                    onClick={() => setConfirmAlbumId(a.id)}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="img-side-section-head">
              <div className="img-side-section-label">生成结果</div>
              <div className="img-side-view-toggle" role="group" aria-label="预览模式">
                <button
                  type="button"
                  className={resultViewMode === 'large' ? 'is-active' : ''}
                  title="大图模式"
                  aria-pressed={resultViewMode === 'large'}
                  onClick={() => setResultViewMode('large')}
                >
                  大图
                </button>
                <button
                  type="button"
                  className={resultViewMode === 'list' ? 'is-active' : ''}
                  title="列表模式（横向卡片）"
                  aria-pressed={resultViewMode === 'list'}
                  onClick={() => setResultViewMode('list')}
                >
                  列表
                </button>
              </div>
            </div>
            <div
              className={`img-side-result-list is-${resultViewMode}`}
            >
              {savedImages.length === 0 && (
                <div className="empty">完成一次改图后，结果会出现在这里</div>
              )}
              {[...savedImages].reverse().map((s) => (
                <div
                  key={s.id}
                  className={`img-side-result-card${
                    currentUrl === s.url ? ' is-active' : ''
                  }${selectedIds.includes(s.id) ? ' is-selected' : ''}`}
                >
                  {checkBtn(s.id)}
                  <button
                    type="button"
                    className="img-side-result-thumb"
                    onClick={() => focusSavedResult(s.url)}
                    title="载入该结果"
                    onContextMenu={(e) => openDownloadMenu(e, s.url, s.label)}
                  >
                    <img src={s.url} alt={s.label} />
                  </button>
                  <div className="img-side-result-caption">
                    <div className="img-side-meta-row">
                      <InlineRename
                        value={repairImageLabel(s.label, 'result')}
                        onChange={(name) => renameSavedImage(s.id, name)}
                      />
                      {s.createdAt > 0 && (
                        <span
                          className="img-side-result-time"
                          title="生成时间"
                        >
                          {formatDateTime(s.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="img-side-result-actions">
                      <button
                        type="button"
                        className="btn ghost sm"
                        title="用该结果覆盖当前原图"
                        onClick={() => {
                          const ok = overwriteOriginalWithResult(
                            s.id,
                            updateSnapshotUrl,
                          );
                          if (ok) pushToast('已用该结果覆盖原图', 'success');
                          else pushToast('无法覆盖原图', 'info');
                        }}
                      >
                        覆盖原图
                      </button>
                      {!fromSnapshot && (
                        <button
                          type="button"
                          className="btn ghost sm"
                          title="将该结果加入原图列表，作为新原图"
                          onClick={() => {
                            const ok = setResultAsOriginal(s.id);
                            if (ok)
                              pushToast(
                                '已设为新原图，并加入原图列表',
                                'success',
                              );
                            else pushToast('无法设为新原图', 'info');
                          }}
                        >
                          设为新原图
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn ghost sm"
                        title="删除"
                        onClick={() => setConfirmResultId(s.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) uploadFiles(files);
            e.target.value = '';
          }}
        />
        <div className="img-side-footer-actions">
          <ImageTo3DButton size="sm" className="img-to-3d-orange" />
          <button
            type="button"
            className="btn holo block"
            onClick={() => fileRef.current?.click()}
          >
            上传本地图片
          </button>
        </div>
      </div>

      {confirmAlbumId && (
        <ConfirmDialog
          message="确定删除该原图及其生成结果？"
          onCancel={() => setConfirmAlbumId(null)}
          onConfirm={() => {
            removeSourceAlbum(confirmAlbumId);
            setSelectedIds((ids) => ids.filter((id) => id !== confirmAlbumId));
            setConfirmAlbumId(null);
          }}
        />
      )}

      {confirmResultId && (
        <ConfirmDialog
          message="确定删除该生成结果？此操作不可撤销。"
          onCancel={() => setConfirmResultId(null)}
          onConfirm={() => {
            removeSavedImage(confirmResultId);
            setSelectedIds((ids) => ids.filter((id) => id !== confirmResultId));
            setConfirmResultId(null);
            pushToast('已删除生成结果', 'success');
          }}
        />
      )}

      {confirmBulkIds && (
        <ConfirmDialog
          message={
            inAlbumList
              ? confirmBulkIds.length === 1
                ? '确定删除选中的原图及其生成结果？'
                : `确定删除选中的 ${confirmBulkIds.length} 张原图及其生成结果？`
              : confirmBulkIds.length === 1
                ? '确定删除选中的生成结果？'
                : `确定删除选中的 ${confirmBulkIds.length} 个生成结果？`
          }
          onCancel={() => setConfirmBulkIds(null)}
          onConfirm={onConfirmBulkDelete}
        />
      )}
    </aside>
  );
}
