import {
  cropFromPadSized,
  padToSupportedRatio,
} from './padImage';
import { requestImageEdit, type ImageEditPayload } from './imageApi';
import { useImageStore, type HotspotPoint } from './useImageStore';
import {
  dataUrlToBinaryMask,
  maskCentroid,
} from './brushRegions';
import {
  compositeLocalStrict,
  padMaskToCanvas,
} from './localComposite';
import { bakeSketchMarksOntoImage } from './bakeSketchMarks';

const LOCAL_SYSTEM = `CRITICAL LOCAL EDIT CONSTRAINTS (must obey strictly):
1. You may change ONLY the region indicated by the mask and/or hotspot.
2. Every pixel outside that region must remain visually identical to the input image (same color, texture, lighting, geometry).
3. Do not restyle, recolor, relight, or remodel anything outside the allowed region.
4. Do not change camera, crop, or aspect. Output the full frame at the same size as the input.
5. Prefer seamless blending only at the boundary of the allowed region.
6. This may be one step in a sequence of brush/mask edits — never drift prior edits or global look.`;

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
}): Promise<string> {
  const state = useImageStore.getState();
  const editModel = state.editModel ?? 'banana-gemini';
  const working =
    opts.imageUrl ??
    (await state.getWorkingImageUrl()) ??
    state.currentUrl;
  const current = working;
  if (!current) throw new Error('没有可编辑的图片');

  const refs =
    opts.materialRefs !== undefined
      ? opts.materialRefs
      : state.selectedMaterialUrls();

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
    return runSketchMarkupEdit(current, [mark], refs, opts.systemHint);
  }

  const pad = await padToSupportedRatio(current);
  const size = await loadSize(current);

  let mode: ImageEditPayload['mode'] = 'global';
  let hotspot: ImageEditPayload['hotspot'];
  let maskDataUrl: string | undefined;
  let naturalMaskUrl: string | undefined;
  let local = false;

  if (opts.naturalMaskUrl) {
    naturalMaskUrl = opts.naturalMaskUrl;
    maskDataUrl = await padMaskToCanvas(naturalMaskUrl, pad);
    mode = 'mask';
    local = true;
  } else if (
    !opts.forceGlobal &&
    !opts.isolated &&
    state.brushRegions.length === 1
  ) {
    naturalMaskUrl = state.brushRegions[0].maskDataUrl;
    maskDataUrl = await padMaskToCanvas(naturalMaskUrl, pad);
    mode = 'mask';
    local = true;
  } else if (
    !opts.forceGlobal &&
    !opts.isolated &&
    state.brushRegions.length > 1
  ) {
    // Never silently fall through to global edit when multiple brush regions exist.
    throw new Error('存在多个涂抹区域，请在各区域填写要求后点「应用」');
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
    ? `LOCAL EDIT ONLY — apply this change exclusively inside the allowed region:\n${opts.prompt}`
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
    return compositeLocalStrict(current, cropped, naturalMaskUrl);
  }
  return cropped;
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

  const result = await requestImageEdit({
    imageDataUrl: pad.dataUrl,
    prompt: userPrompt,
    systemHint: [SKETCH_MARKUP_SYSTEM, systemHint].filter(Boolean).join('\n\n'),
    mode: 'sketch',
    materialRefs: refs.length ? refs : undefined,
    model: useImageStore.getState().editModel ?? 'banana-gemini',
  });

  return cropFromPadSized(
    result.imageDataUrl,
    pad.originalCrop,
    pad.canvasW,
    pad.canvasH,
    size.w,
    size.h,
  );
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
    });
  }
  return current;
}

async function loadSize(url: string) {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('load fail'));
    img.src = url;
  });
  return { w: img.naturalWidth, h: img.naturalHeight };
}
