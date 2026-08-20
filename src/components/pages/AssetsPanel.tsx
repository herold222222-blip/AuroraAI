import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAssetStore,
  type AssetItem,
  type AssetKind,
} from '../../store/useAssetStore';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import { useAuthStore } from '../../store/useAuthStore';
import { assetThumbUrl } from '../../utils/assetThumb';

type KindFilter = 'all' | AssetKind;
type SortMode = 'newest' | 'oldest' | 'project';
const UNASSIGNED_PROJECT_ID = '__unassigned';

/** Compact timestamp for card meta (date + HH:mm). */
function formatTimeCompact(ts: number) {
  try {
    const d = new Date(ts);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  } catch {
    return String(ts);
  }
}

function AssetNameField({
  item,
  onRename,
}: {
  item: AssetItem;
  onRename: (id: string, label: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(item.label);
  }, [item.label, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === item.label) {
      setDraft(item.label);
      return;
    }
    const ok = await onRename(item.id, next);
    if (!ok) setDraft(item.label);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="assets-name-input"
        value={draft}
        aria-label="文件名"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(item.label);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="assets-name"
      title="点击修改文件名"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {item.label}
    </button>
  );
}

function formatLimit(n: number) {
  return Number.isFinite(n) ? String(n) : '∞';
}

/** Local calendar day key YYYY-MM-DD */
function dayKey(ts: number) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startThat = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (startThat === startToday) return `今天 · ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  if (startThat === startToday - dayMs) {
    return `昨天 · ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${weekdays[d.getDay()]}`;
}

export function AssetsPanel() {
  const items = useAssetStore((s) => s.items);
  const loaded = useAssetStore((s) => s.loaded);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);
  const removeAssets = useAssetStore((s) => s.removeAssets);
  const renameAsset = useAssetStore((s) => s.renameAsset);
  const counts = useAssetStore((s) => s.counts);
  const limits = useAssetStore((s) => s.limits);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const projects = useAppStore((s) => s.projects);
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
  const [preview, setPreview] = useState<AssetItem | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync with top-menu project list; keep orphan asset project ids if any.
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.name?.trim() || '未命名项目');
    }
    if (items.some((it) => !it.projectId)) {
      map.set(UNASSIGNED_PROJECT_ID, '未立项');
    }
    for (const it of items) {
      if (!it.projectId || map.has(it.projectId)) continue;
      map.set(it.projectId, it.projectName?.trim() || '未命名项目');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
  }, [projects, items]);

  useEffect(() => {
    if (projectId === 'all') return;
    if (!projectOptions.some(([id]) => id === projectId)) setProjectId('all');
  }, [projectId, projectOptions]);

  const filtered = useMemo(() => {
    let list = items.slice();
    if (kind !== 'all') list = list.filter((x) => x.kind === kind);
    if (projectId === UNASSIGNED_PROJECT_ID) {
      list = list.filter((x) => !x.projectId);
    } else if (projectId !== 'all') {
      list = list.filter((x) => x.projectId === projectId);
    }
    if (sort === 'newest') list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === 'oldest') list.sort((a, b) => a.createdAt - b.createdAt);
    else list.sort((a, b) => {
      const byName = (a.projectName || '').localeCompare(b.projectName || '', 'zh-CN');
      if (byName !== 0) return byName;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [items, kind, projectId, sort]);

  /** Insert date separators whenever the calendar day changes in list order. */
  const rows = useMemo(() => {
    const out: Array<
      | { type: 'day'; key: string; label: string }
      | { type: 'item'; item: AssetItem }
    > = [];
    let lastDay = '';
    for (const item of filtered) {
      const key = dayKey(item.createdAt);
      if (key !== lastDay) {
        lastDay = key;
        out.push({ type: 'day', key, label: formatDayLabel(item.createdAt) });
      }
      out.push({ type: 'item', item });
    }
    return out;
  }, [filtered]);

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

  const editImageAsset = (item: AssetItem) => {
    if (item.kind !== 'image') return;
    setPreview(null);
    enterImageModule();
    const inSaved = savedImages.some(
      (x) => x.url === item.url || x.id === item.id,
    );
    if (inSaved) focusSavedResult(item.url);
    else openFromUrl(item.url, { label: item.label });
  };

  const openModelAsset = (item: AssetItem) => {
    if (item.kind !== 'model') return;
    if (!requireModelAccess()) return;
    setMeshyModelUrl(item.url);
    goto('workbench3d');
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

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

      {loading || !loaded ? (
        <div className="assets-empty">正在加载当前用户资产…</div>
      ) : filtered.length === 0 ? (
        <div className="assets-empty">
          {projectId !== 'all'
            ? '该项目下暂无资产。生成图片或 Meshy 模型后会自动归入当前项目。'
            : '暂无资产。生成图片或 Meshy 模型后会自动出现在这里。'}
        </div>
      ) : (
        <ul className="assets-grid">
          {rows.map((row) => {
            if (row.type === 'day') {
              return (
                <li key={`day-${row.key}`} className="assets-day-sep" aria-label={row.label}>
                  <span>{row.label}</span>
                </li>
              );
            }
            const item = row.item;
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
                  onClick={() =>
                    item.kind === 'image'
                      ? setPreview(item)
                      : openModelAsset(item)
                  }
                  title={item.kind === 'image' ? '预览' : '打开模型'}
                >
                  {item.kind === 'image' ? (
                    <img
                      src={assetThumbUrl(item.url, 360)}
                      alt={item.label}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        console.error('[assets] thumb load failed', {
                          id: item.id,
                          label: item.label,
                          url: item.url,
                        });
                        (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
                      }}
                    />
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
                  <div className="assets-meta-top">
                    <AssetNameField item={item} onRename={renameAsset} />
                    <button
                      type="button"
                      className="assets-del"
                      title="删除"
                      onClick={() => setConfirmIds([item.id])}
                    >
                      删除
                    </button>
                  </div>
                  <div className="assets-meta-sub">
                    <span className="assets-kind">
                      {item.kind === 'image' ? '图片' : '模型'}
                    </span>
                    {item.projectName && (
                      <>
                        <span className="assets-meta-sep" aria-hidden>
                          ·
                        </span>
                        <span className="assets-project" title={item.projectName}>
                          {item.projectName}
                        </span>
                      </>
                    )}
                    <span className="assets-meta-sep" aria-hidden>
                      ·
                    </span>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {formatTimeCompact(item.createdAt)}
                    </time>
                  </div>
                  {item.kind === 'image' && (
                    <div className="assets-meta-actions">
                      <button
                        type="button"
                        className="assets-edit-btn"
                        onClick={() => editImageAsset(item)}
                      >
                        去编辑
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && preview.kind === 'image' && (
        <div
          className="assets-preview-backdrop"
          role="presentation"
          onClick={() => setPreview(null)}
        >
          <div
            className="assets-preview"
            role="dialog"
            aria-modal="true"
            aria-label={preview.label}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="assets-preview-head">
              <strong title={preview.label}>{preview.label}</strong>
              <button
                type="button"
                className="assets-preview-close"
                aria-label="关闭预览"
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            <div className="assets-preview-body">
              <img
                src={preview.url}
                alt={preview.label}
                decoding="async"
                onError={() => {
                  console.error('[assets] preview load failed', {
                    id: preview.id,
                    label: preview.label,
                    url: preview.url,
                  });
                }}
              />
            </div>
            <div className="assets-preview-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPreview(null)}
              >
                关闭
              </button>
              <button
                type="button"
                className="btn holo"
                onClick={() => editImageAsset(preview)}
              >
                去编辑
              </button>
            </div>
          </div>
        </div>
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
