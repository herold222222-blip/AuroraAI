import { apiSaveAsset, apiListAssets } from '../api/assetsApi';
import { ensureCanUploadImage } from '../store/assetQuota';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { isScratchProjectId } from '../store/projectBag';
import { useImageStore, type SourceAlbum } from './useImageStore';
import { ensureUnderMaxBytes, UPLOAD_MAX_BYTES } from './padImage';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('读取文件失败'));
    r.readAsDataURL(file);
  });
}

/**
 * 上传原图：校验配额 → 超 10MB 自动压缩 → OSS+DB（role=original）→ 写入原图列表 → 云存项目。
 * 默认始终新增；仅 replaceCurrent=true 时覆盖当前原图记录。
 */
export async function uploadOriginalImageFile(
  file: File,
  opts?: { label?: string; replaceCurrent?: boolean },
): Promise<{ ok: true; url: string; id: string } | { ok: false; error: string }> {
  const pushToast = useAppStore.getState().pushToast;
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: '仅支持图片文件' };
  }
  if (!(await ensureCanUploadImage())) {
    return { ok: false, error: '已达图片上限' };
  }

  try {
    const raw = await readFileAsDataUrl(file);
    const { dataUrl, compressed, bytes } = await ensureUnderMaxBytes(
      raw,
      UPLOAD_MAX_BYTES,
    );
    if (bytes > UPLOAD_MAX_BYTES) {
      return {
        ok: false,
        error: '图片过大，压缩后仍超过 10MB，请更换较小的图片',
      };
    }
    if (compressed) {
      pushToast('图片超过 10MB，已自动压缩后上传', 'info');
    }

    const app = useAppStore.getState();
    const formal = !isScratchProjectId(app.activeProjectId);
    const projectId = formal ? app.activeProjectId : '';
    const projectName = formal ? app.projectName : '';
    const token = useAuthStore.getState().token;
    const img = useImageStore.getState();
    const label =
      opts?.label ||
      file.name.replace(/\.[^.]+$/, '') ||
      `原图 ${img.sourceAlbums.length + 1}`;
    const reuseId =
      opts?.replaceCurrent === true && img.currentUrl && img.activeSourceId
        ? img.activeSourceId
        : null;
    const id =
      reuseId ||
      `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    let finalUrl = dataUrl;
    if (token) {
      const remote = await apiSaveAsset(
        {
          id,
          kind: 'image',
          url: dataUrl,
          label,
          projectId,
          projectName,
          createdAt: Date.now(),
          role: 'original',
        },
        token,
      );
      finalUrl = remote.url || dataUrl;
    }

    if (reuseId) {
      img.replaceCurrentSourceImage(finalUrl, { label });
    } else {
      img.openFromUrl(finalUrl, { label, albumId: id });
    }

    void app.saveCurrentProjectToCloud({ silent: true });
    try {
      const { reloadAssetsFromDatabase } = await import(
        '../store/useAssetStore'
      );
      await reloadAssetsFromDatabase();
    } catch (err) {
      console.warn('[image] post-upload sync', err);
    }

    return { ok: true, url: finalUrl, id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * 从数据库拉取原图并刷新列表。
 * 原图列表与资产库同源：当前用户全部 role=original（不按项目过滤，避免草稿/项目切换丢图）。
 * 切换用户后由 reloadAssetsFromDatabase / logout 触发重新渲染。
 */
export async function syncOriginalAlbumsFromDatabase(): Promise<void> {
  const token = useAuthStore.getState().token;
  if (!token) {
    return;
  }
  try {
    const entries = await apiListAssets({ role: 'original' }, token);
    const prev = useImageStore.getState().sourceAlbums;
    const snapshotAlbums = prev.filter((a) => Boolean(a.sourceSnapshotId));
    const next: SourceAlbum[] = entries.map((e) => {
      const hit =
        prev.find((a) => a.id === e.id) ||
        prev.find((a) => a.url === e.url);
      return {
        id: e.id,
        url: e.url,
        label: e.label || '原图',
        createdAt: e.createdAt || Date.now(),
        results: hit?.results ? hit.results.map((r) => ({ ...r })) : [],
        sourceSnapshotId: hit?.sourceSnapshotId,
      };
    });
    for (const shot of snapshotAlbums) {
      if (
        next.some(
          (a) =>
            a.id === shot.id || a.sourceSnapshotId === shot.sourceSnapshotId,
        )
      ) {
        continue;
      }
      next.push({
        ...shot,
        results: shot.results.map((r) => ({ ...r })),
      });
    }

    // 稳定排序：新的在前
    next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const state = useImageStore.getState();
    const activeStill =
      next.find((a) => a.id === state.activeSourceId) ||
      next.find((a) => a.url === state.originalUrl) ||
      next.find((a) => a.url === state.currentUrl);
    useImageStore.setState({
      sourceAlbums: next,
      ...(activeStill
        ? {
            activeSourceId: activeStill.id,
            originalUrl: activeStill.url,
          }
        : next.length === 0
          ? {
              activeSourceId: null,
              originalUrl: null,
              currentUrl: null,
              savedImages: [],
              sourceSidebarMode: 'list' as const,
            }
          : {}),
    });
  } catch (err) {
    console.warn('[image] sync originals from db', err);
  }
}

/** 生成图入库前压缩到 10MB 内 */
export async function prepareGeneratedImageUrl(
  url: string,
): Promise<{ url: string; compressed: boolean }> {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const { dataUrl, compressed, bytes } = await ensureUnderMaxBytes(
        url,
        UPLOAD_MAX_BYTES,
      );
      if (bytes > UPLOAD_MAX_BYTES) return { url, compressed: false };
      return { url: dataUrl, compressed };
    } catch {
      return { url, compressed: false };
    }
  }
  const { dataUrl, compressed } = await ensureUnderMaxBytes(
    url,
    UPLOAD_MAX_BYTES,
  );
  return { url: dataUrl, compressed };
}
