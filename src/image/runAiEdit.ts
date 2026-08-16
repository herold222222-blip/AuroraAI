import {
  cropFromPadSized,
  padToSupportedRatio,
} from './padImage';
import { requestImageEdit, type ImageEditPayload } from './imageApi';
import { useImageStore, type HotspotPoint } from './useImageStore';
import {
  dataUrlToBinaryMask,
  maskBounds,
  maskCentroid,
} from './brushRegions';
import {
  bakeMaskOverlayOntoImage,
  compositeLocalStrict,
  cropImageRect,
  expandNaturalMaskForLocalEdit,
  padMaskToCanvas,
  pasteImageRect,
  upscaleToMinSide,
} from './localComposite';
import { bakeSketchMarksOntoImage } from './bakeSketchMarks';
import { applyAuroraWatermark } from './auroraWatermark';
import { useAuthStore } from '../store/useAuthStore';

/** Suppress duplicate toasts when a quota modal is already open. */
export function reportAiEditError(
  err: unknown,
  pushToast: (msg: string, type?: 'error' | 'info' | 'success' | 'warning') => void,
) {
  if (useAuthStore.getState().quotaOpen) return;
  pushToast(err instanceof Error ? err.message : String(err), 'error');
}

/** Admin never watermarks; regular users follow account setting (default on). */
function shouldApplyWatermark(): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return true;
  if (user.role === 'admin') return false;
  return user.watermarkEnabled !== false;
}

async function maybeWatermark(url: string): Promise<string> {
  if (!shouldApplyWatermark()) return url;
  return applyAuroraWatermark(url);
}

const LOCAL_SYSTEM = `CRITICAL LOCAL EDIT CONSTRAINTS (must obey strictly):
1. You may change ONLY the region indicated by the mask and/or hotspot.
2. Every pixel outside that region must remain visually identical to the input image (same color, texture, lighting, geometry).
3. Do not restyle, recolor, relight, or remodel anything outside the allowed region.
4. Do not change camera, crop, or aspect. Output the full frame at the same size as the input.
5. Prefer seamless blending only at the boundary of the allowed region.
6. This may be one step in a sequence of brush/mask edits — never drift prior edits or global look.
7. INSERT / ADD elements (people, furniture, props, etc.): place them INTO the existing scene from IMAGE 1.
   - Reconstruct matching ground, pavement, water, walls, and lighting from IMAGE 1 in any allowed pixels not occupied by the new subject.
   - Match perspective, scale, light direction, color temperature, and contact shadows of the surrounding scene.
   - NEVER fill the mask with solid white, gray, studio backdrop, cutout halo, or any flat empty background.
   - The mask only marks WHERE edits are allowed — it is NOT a white canvas to paint on.
8. COMPLETE SUBJECT INSIDE THE MASK (critical):
   - The entire added subject must fit fully inside the white/bright mask — head to toe / full object, no cropped limbs.
   - Scale and compose so nothing important is cut off by the mask boundary (no missing arms, legs, feet, or props).
   - Prefer a slightly smaller subject that is complete over a larger subject that is truncated.`;

/** Matches Gemini app sketch/markup editing: ink is on the photo. */
const SKETCH_MARKUP_SYSTEM = `GEMINI-STYLE SKETCH / MARKUP EDIT (must obey strictly):
1. IMAGE 1 is a photo with red freehand sketch strokes and red numbered badges drawn ON TOP of subjects to edit.
2. Each red number (1, 2, 3, …) identifies a distinct subject / material / component under that mark.
3. Read EVERY "Mark N: …" instruction and apply it ONLY to the subject indicated by mark N.
4. When multiple marks exist, perform ALL mark edits in a SINGLE coherent pass — do not ignore later marks.
5. Do NOT change unmarked subjects, background, sky, global lighting, color grade, or camera.
6. Preserve geometry, edges, and silhouettes of unmarked elements.
7. CRITICAL: The output image must contain NO red sketch strokes, NO number badges, and NO markup artifacts — remove all annotations completely.
8. Keep full-frame size identical to the input. Blend edits seamlessly at subject boundaries.
9. For material/color swaps, match the scene's existing light direction and contact shadows.`;

export async function runAiEdit(opts: {
  prompt: string;
  systemHint?: string;
  forceGlobal?: boolean;
  /** Override working image (for sequential multi-point). */
  imageUrl?: string;
  /** Override single hotspot (natural coords). */
  hotspot?: {
    x: number;
    y: number;
    n?: number;
    prompt?: string;
    strokeMaskDataUrl?: string;
  } | null;
  /** Override natural-res mask data URL (white/black). */
  naturalMaskUrl?: string;
  /** Override material / style reference images (data URLs). */
  materialRefs?: string[];
  /** Skip reading brush mask / store hotspots; use only overrides. */
  isolated?: boolean;
  /** Skip Aurora watermark (for intermediate multi-step AI edits). */
  skipWatermark?: boolean;
}): Promise<string> {
  const state = useImageStore.getState();
  const editModel = state.editModel ?? 'banana-gemini';

  // Client-side quota gate: Gemini → offer Qwen; both out → full exhausted dialog.
  const auth = useAuthStore.getState();
  if (auth.user && auth.user.role !== 'admin') {
    const { isEditQuotaExhausted } = await import('../api/authApi');
    const geminiDone = isEditQuotaExhausted(auth.user, 'gemini');
    const qwenDone = isEditQuotaExhausted(auth.user, 'qwen');
    if (editModel !== 'qwen-image' && geminiDone) {
      await auth.handleEditQuotaError('banana-gemini');
      throw new Error(
        qwenDone
          ? '目前您的免费额度已经全部用完，请等待明天更新，或者联系万生：19806651984.'
          : '您的Gemini免费额度已经用完，当前自动切换到千问模型',
      );
    }
    if (editModel === 'qwen-image' && qwenDone) {
      await auth.handleEditQuotaError('qwen-image');
      throw new Error(
        geminiDone
          ? '目前您的免费额度已经全部用完，请等待明天更新，或者联系万生：19806651984.'
          : '千问免费额度已用完，请切换到 Gemini 模型后再试',
      );
    }
  }

  const working =
    opts.imageUrl ??
    (await state.getWorkingImageUrl()) ??
    state.currentUrl;
  const current = working;
  if (!current) throw new Error('没有可编辑的图片');

  const finish = async (url: string) =>
    opts.skipWatermark ? url : maybeWatermark(url);

  const refs =
    opts.materialRefs !== undefined
      ? opts.materialRefs
      : state.selectedMaterialUrls();

  // Enforce asset limits: at image cap → cannot edit (creates new result asset)
  const {
    refreshAssetCounts,
    isImageAtCap,
    MSG_IMAGE_CAP,
  } = await import('../store/assetQuota');
  const counts = await refreshAssetCounts();
  if (isImageAtCap(counts)) {
    throw new Error(MSG_IMAGE_CAP);
  }

  const overrideHotspot =
    opts.hotspot !== undefined ? opts.hotspot : null;
  const useStoreHotspot =
    !opts.isolated && !opts.forceGlobal && state.hotspots.length === 1
      ? state.hotspots[0]
      : null;
  const activeHotspot = overrideHotspot ?? useStoreHotspot;

  // Sketch marks → Gemini markup path (ink baked onto the photo).
  if (!opts.forceGlobal && activeHotspot) {
    const mark: HotspotPoint = {
      id: 'tmp',
      n: activeHotspot.n ?? useStoreHotspot?.n ?? 1,
      x: activeHotspot.x,
      y: activeHotspot.y,
      prompt: (activeHotspot.prompt ?? opts.prompt).trim(),
      strokeMaskDataUrl: activeHotspot.strokeMaskDataUrl,
    };
    if (!mark.prompt) throw new Error('请填写素描标记的修改要求');
    return finish(
      await runSketchMarkupEdit(
        current,
        [mark],
        refs,
        opts.systemHint,
        true,
      ),
    );
  }

  const isQwen = editModel === 'qwen-image';

  // Resolve natural brush mask early (before pad) so Qwen can use ROI crop-edit.
  let naturalMaskUrl: string | undefined;
  const maskExpandRadius = (nw: number, nh: number) => {
    const m = Math.min(nw, nh);
    return isQwen
      ? Math.max(18, Math.round(m * 0.038))
      : Math.max(10, Math.round(m * 0.022));
  };

  if (opts.naturalMaskUrl) {
    const { w: mw, h: mh } = await loadSize(opts.naturalMaskUrl);
    naturalMaskUrl = await expandNaturalMaskForLocalEdit(
      opts.naturalMaskUrl,
      maskExpandRadius(mw, mh),
    );
  } else if (
    !opts.forceGlobal &&
    !opts.isolated &&
    state.brushRegions.length === 1
  ) {
    const srcMask = state.brushRegions[0].maskDataUrl;
    const { w: mw, h: mh } = await loadSize(srcMask);
    naturalMaskUrl = await expandNaturalMaskForLocalEdit(
      srcMask,
      maskExpandRadius(mw, mh),
    );
  } else if (
    !opts.forceGlobal &&
    !opts.isolated &&
    state.brushRegions.length > 1
  ) {
    throw new Error('存在多个涂抹区域，请在各区域填写要求后点「应用」');
  }

  // Qwen: crop the brush bbox, edit that patch, paste back — full-frame red
  // guides often make Qwen only erase the tint with no real content change.
  if (isQwen && naturalMaskUrl) {
    return finish(
      await runQwenBrushRoiEdit({
        imageUrl: current,
        naturalMaskUrl,
        prompt: opts.prompt,
        materialRefs: refs,
      }),
    );
  }

  const pad = await padToSupportedRatio(current);
  const size = await loadSize(current);

  let mode: ImageEditPayload['mode'] = 'global';
  let hotspot: ImageEditPayload['hotspot'];
  let maskDataUrl: string | undefined;
  let local = false;

  if (naturalMaskUrl) {
    maskDataUrl = await padMaskToCanvas(naturalMaskUrl, pad);
    mode = 'mask';
    local = true;
  }

  if (local && mode === 'mask' && !maskDataUrl) {
    throw new Error('局部编辑需要有效的素描标记或涂抹区域');
  }

  // Brush/mask: send region centroid as focus so Gemini stays locked across iterative edits.
  if (local && mode === 'mask' && naturalMaskUrl && !hotspot) {
    try {
      const { mask, w, h } = await dataUrlToBinaryMask(naturalMaskUrl);
      const c = maskCentroid(mask, w, h);
      hotspot = pad.mapPoint(c.x, c.y);
    } catch {
      /* optional focus hint */
    }
  }

  const systemHint = local
    ? [LOCAL_SYSTEM, opts.systemHint].filter(Boolean).join('\n\n')
    : opts.systemHint;

  const userPrompt = local
    ? [
        'LOCAL EDIT ONLY — apply this change exclusively inside the allowed region.',
        'If adding/inserting a subject: generate the COMPLETE subject fully inside the mask (no missing limbs or cropped parts); scale to fit.',
        'Fuse into IMAGE 1 scene content (ground/water/walls/light). No white/flat cutout backgrounds.',
        `Instruction:\n${opts.prompt}`,
      ].join('\n')
    : opts.prompt;

  const result = await requestImageEdit({
    imageDataUrl: pad.dataUrl,
    prompt: userPrompt,
    systemHint,
    mode,
    hotspot: local ? hotspot : undefined,
    maskDataUrl,
    materialRefs: refs.length ? refs : undefined,
    model: editModel,
  });

  const cropped = await cropFromPadSized(
    result.imageDataUrl,
    pad.originalCrop,
    pad.canvasW,
    pad.canvasH,
    size.w,
    size.h,
  );

  if (local && naturalMaskUrl) {
    return finish(
      await compositeLocalStrict(current, cropped, naturalMaskUrl),
    );
  }
  return finish(cropped);
}

/**
 * Qwen brush path: edit a cropped ROI of the smear region, then paste + mask-composite.
 * Avoids full-frame “only remove red tint” no-op failures.
 */
async function runQwenBrushRoiEdit(opts: {
  imageUrl: string;
  naturalMaskUrl: string;
  prompt: string;
  materialRefs: string[];
}): Promise<string> {
  const { mask, w, h } = await dataUrlToBinaryMask(opts.naturalMaskUrl);
  const padPx = Math.max(28, Math.round(Math.min(w, h) * 0.05));
  const box = maskBounds(mask, w, h, padPx);
  if (!box || box.w < 8 || box.h < 8) {
    throw new Error('涂抹区域无效，请重新涂抹后再试');
  }

  const cropUrl = await cropImageRect(opts.imageUrl, box);
  const cropMaskUrl = await cropImageRect(opts.naturalMaskUrl, box);
  const guided = await bakeMaskOverlayOntoImage(cropUrl, cropMaskUrl, 0.48);
  const sendUrl = await upscaleToMinSide(guided, 512);

  const result = await requestImageEdit({
    imageDataUrl: sendUrl,
    prompt: [
      '这是涂抹区域的局部图，整张图都需要按要求编辑。',
      '必须产生明显可见的变化，不能几乎等于原图。',
      '若增加人物/物体：在图中生成完整主体（含双腿双脚），与地面融合，不要白底。',
      `具体要求：${opts.prompt.trim()}`,
    ].join('\n'),
    mode: 'mask',
    visualGuideBaked: true,
    materialRefs: opts.materialRefs.length ? opts.materialRefs : undefined,
    model: 'qwen-image',
  });

  const pasted = await pasteImageRect(opts.imageUrl, result.imageDataUrl, box);
  return compositeLocalStrict(opts.imageUrl, pasted, opts.naturalMaskUrl, undefined, {
    rejectWhiteCutout: false,
  });
}

/**
 * Gemini-style sketch edit: bake red numbered marks onto the photo,
 * send one request with all Mark N instructions, return a clean full frame.
 */
export async function runSketchMarkupEdit(
  imageUrl: string,
  marks: HotspotPoint[],
  materialRefs?: string[],
  systemHint?: string,
  skipWatermark?: boolean,
): Promise<string> {
  const points = marks.filter((p) => p.prompt.trim());
  if (!points.length) {
    throw new Error('请至少在一个编号对话框中填写修改要求');
  }

  const annotated = await bakeSketchMarksOntoImage(
    imageUrl,
    points.map((p) => ({
      n: p.n,
      x: p.x,
      y: p.y,
      strokeMaskDataUrl: p.strokeMaskDataUrl,
    })),
  );

  const pad = await padToSupportedRatio(annotated);
  const size = await loadSize(imageUrl);

  const markLines = points
    .map((p) => `Mark ${p.n}: ${p.prompt.trim()}`)
    .join('\n');

  const userPrompt =
    points.length === 1
      ? [
          `The photo has a red sketch mark numbered ${points[0].n} drawn on the subject to edit.`,
          `Apply the instruction ONLY to that marked subject, then remove all red markup from the output.`,
          markLines,
        ].join('\n')
      : [
          `The photo has ${points.length} red numbered sketch marks (Gemini markup).`,
          `Apply EACH Mark N instruction ONLY to the subject under mark N.`,
          `Perform all mark edits together in one pass.`,
          `Remove every red stroke and number badge from the final image.`,
          markLines,
        ].join('\n');

  const refs =
    materialRefs ?? useImageStore.getState().selectedMaterialUrls();

  const editModel = useImageStore.getState().editModel ?? 'banana-gemini';
  const isQwen = editModel === 'qwen-image';
  // Sketch ink is already baked on the photo; Qwen gets Chinese prompt server-side.
  const result = await requestImageEdit({
    imageDataUrl: pad.dataUrl,
    prompt: isQwen
      ? [
          ...points.map((p) => `标记${p.n}：${p.prompt.trim()}`),
          '请按上述标记逐一修改对应主体，并去除全部红色标注。',
        ].join('\n')
      : userPrompt,
    systemHint: isQwen
      ? systemHint
      : [SKETCH_MARKUP_SYSTEM, systemHint].filter(Boolean).join('\n\n'),
    mode: 'sketch',
    materialRefs: refs.length ? refs : undefined,
    model: editModel,
  });

  const cropped = await cropFromPadSized(
    result.imageDataUrl,
    pad.originalCrop,
    pad.canvasW,
    pad.canvasH,
    size.w,
    size.h,
  );
  return skipWatermark ? cropped : maybeWatermark(cropped);
}

/** Apply all numbered sketch marks in one Gemini markup pass. */
export async function runMultiHotspotEdits(): Promise<string> {
  const state = useImageStore.getState();
  const start =
    (await state.getWorkingImageUrl()) ?? state.currentUrl;
  if (!start) throw new Error('没有可编辑的图片');
  return runSketchMarkupEdit(start, state.hotspots);
}

/** Apply each numbered brush-region prompt sequentially. */
export async function runMultiBrushEdits(): Promise<string> {
  const state = useImageStore.getState();
  const start = state.currentUrl;
  if (!start) throw new Error('没有可编辑的图片');
  const regions = state.brushRegions.filter((r) => r.prompt.trim());
  if (!regions.length) {
    throw new Error('请至少在一个涂抹区域对话框中填写修改要求');
  }

  let current = start;
  for (const r of regions) {
    current = await runAiEdit({
      prompt: r.prompt.trim(),
      imageUrl: current,
      naturalMaskUrl: r.maskDataUrl,
      isolated: true,
      skipWatermark: true,
    });
  }
  return maybeWatermark(current);
}

async function loadSize(url: string) {
  const { loadImageEl } = await import('./loadImage');
  const img = await loadImageEl(url);
  return { w: img.naturalWidth, h: img.naturalHeight };
}
