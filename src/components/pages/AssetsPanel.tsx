import { useEffect, useMemo, useState } from 'react';
import {
  useAssetStore,
  type AssetItem,
  type AssetKind,
} from '../../store/useAssetStore';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { useAuthStore } from '../../store/useAuthStore';

type KindFilter = 'all' | AssetKind;
type SortMode = 'newest' | 'oldest' | 'project';

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

function formatLimit(n: number) {
  return Number.isFinite(n) ? String(n) : '∞';
}

export function AssetsPanel() {
  const items = useAssetStore((s) => s.items);
  const loaded = useAssetStore((s) => s.loaded);
  const load = useAssetStore((s) => s.load);
  const removeAssets = useAssetStore((s) => s.removeAssets);
  const counts = useAssetStore((s) => s.counts);
  const limits = useAssetStore((s) => s.limits);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const enterImageModule = useAppStore((s) => s.enterImageModule);
  const requireModelAccess = useAppStore((s) => s.requireModelAccess);
  const setMeshyModelUrl = useAppStore((s) => s.setMeshyModelUrl);
  const goto = useAppStore((s) => s.goto);
  const pushToast = useAppStore((s) => s.pushToast);

  const focusSavedResult = useImageStore((s) => s.focusSavedResult);
  const openFromUrl = useImageStore((s) => s.openFromUrl);
  const removeResultsByRefs = useImageStore((s) => s.removeResultsByRefs);
  const savedImages = useImageStore((s) => s.savedImages);

  const [kind, setKind] = useState<KindFilter>('all');
  const [projectId, setProjectId] = useState<string>('all');
  const [sort, setSort] = useState<SortMode>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      if (!map.has(it.projectId)) map.set(it.projectId, it.projectName || '未命名项目');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
  }, [items]);

  const filtered = useMemo(() => {
    let list = items.slice();
    if (kind !== 'all') list = list.filter((x) => x.kind === kind);
    if (projectId !== 'all') list = list.filter((x) => x.projectId === projectId);
    if (sort === 'newest') list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === 'oldest') list.sort((a, b) => a.createdAt - b.createdAt);
    else list.sort((a, b) => {
      const byName = (a.projectName || '').localeCompare(b.projectName || '', 'zh-CN');
      if (byName !== 0) return byName;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [items, kind, projectId, sort]);

  const quota = counts();
  const cap = limits();
  const admin = isAdmin();

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.map((x) => x.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const syncPurge = (removed: AssetItem[]) => {
    const imageIds = removed.filter((x) => x.kind === 'image').map((x) => x.id);
    const imageUrls = removed.filter((x) => x.kind === 'image').map((x) => x.url);
    if (imageIds.length || imageUrls.length) {
      removeResultsByRefs({ ids: imageIds, urls: imageUrls });
    }
    const modelUrls = new Set(
      removed.filter((x) => x.kind === 'model').map((x) => x.url),
    );
    if (modelUrls.size) {
      const cur = useAppStore.getState().meshyModelUrl;
      if (cur && modelUrls.has(cur)) setMeshyModelUrl(null);
    }
  };

  const doDelete = async (ids: string[]) => {
    const removed = await removeAssets(ids);
    syncPurge(removed);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setConfirmIds(null);
    pushToast(`已删除 ${removed.length} 项资产`, 'success');
  };

  const openAsset = (item: AssetItem) => {
    if (item.kind === 'image') {
      enterImageModule();
      const inSaved = savedImages.some((x) => x.url === item.url || x.id === item.id);
      if (inSaved) focusSavedResult(item.url);
      else openFromUrl(item.url, { label: item.label });
      return;
    }
    if (!requireModelAccess()) return;
    setMeshyModelUrl(item.url);
    goto('workbench3d');
  };

  return (
    <div className="assets-page">
      <header className="assets-head">
        <div>
          <h2>资产库</h2>
          <p>历史生成的图片与 Meshy 三维模型，按项目筛选与管理。</p>
        </div>
        <div className="assets-quota" title={admin ? '管理员无上限' : undefined}>
          图片 {quota.image}/{formatLimit(cap.image)} · 模型 {quota.model}/
          {formatLimit(cap.model)}
        </div>
      </header>

      <div className="assets-toolbar">
        <label className="assets-field">
          <span>类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
            <option value="all">全部</option>
            <option value="image">图片</option>
            <option value="model">模型</option>
          </select>
        </label>
        <label className="assets-field">
          <span>项目</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="all">全部项目</option>
            {projectOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="assets-field">
          <span>排序</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="newest">时间新→旧</option>
            <option value="oldest">时间旧→新</option>
            <option value="project">按项目名</option>
          </select>
        </label>
        <div className="assets-toolbar-actions">
          <button type="button" className="btn ghost" onClick={selectAllVisible} disabled={!filtered.length}>
            全选当前列表
          </button>
          <button type="button" className="btn ghost" onClick={clearSelection} disabled={!selected.size}>
            清除选择
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={!selected.size}
            onClick={() => setConfirmIds([...selected])}
          >
            删除所选 ({selected.size})
          </button>
        </div>
      </div>

      {!loaded ? (
        <div className="assets-empty">正在加载资产…</div>
      ) : filtered.length === 0 ? (
        <div className="assets-empty">暂无资产。生成图片或 Meshy 模型后会自动出现在这里。</div>
      ) : (
        <ul className="assets-grid">
          {filtered.map((item) => {
            const checked = selected.has(item.id);
            return (
              <li key={item.id} className={`assets-card${checked ? ' selected' : ''}`}>
                <label className="assets-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`选择 ${item.label}`}
                  />
                </label>
                <button
                  type="button"
                  className="assets-thumb"
                  onClick={() => openAsset(item)}
                  title="打开"
                >
                  {item.kind === 'image' ? (
                    <img src={item.url} alt={item.label} loading="lazy" />
                  ) : (
                    <div className="assets-model-placeholder" aria-hidden>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 12L20 7.5M12 12V21M12 12L4 7.5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                      </svg>
                      <span>GLB</span>
                    </div>
                  )}
                </button>
                <div className="assets-meta">
                  <strong>{item.label}</strong>
                  <span className="assets-kind">{item.kind === 'image' ? '图片' : '模型'}</span>
                  <span>{item.projectName || '未命名项目'}</span>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {formatTime(item.createdAt)}
                  </time>
                </div>
                <button
                  type="button"
                  className="assets-del"
                  onClick={() => setConfirmIds([item.id])}
                >
                  删除
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {confirmIds && (
        <div className="assets-confirm-backdrop" role="presentation">
          <div className="assets-confirm" role="dialog" aria-modal="true" aria-labelledby="assets-confirm-title">
            <h3 id="assets-confirm-title">确认删除</h3>
            <p>
              将删除 {confirmIds.length} 项资产
              {confirmIds.length === 1 ? '' : '（批量）'}
              。若当前项目侧栏仍引用相同内容，会一并清理。
            </p>
            <div className="assets-confirm-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmIds(null)}>
                取消
              </button>
              <button type="button" className="btn danger" onClick={() => void doDelete(confirmIds)}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
