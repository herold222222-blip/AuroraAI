import {
  cropFromPadSized,
  padToSupportedRatio,
} from './padImage';
import { requestImageEdit, type ImageEditPayload } from './imageApi';
import { useImageStore } from './useImageStore';
import {
  compositeHotspotLocal,
  compositeLocalStrict,
  hotspotRoiAlpha,
  padMaskToCanvas,
} from './localComposite';

const LOCAL_SYSTEM = `CRITICAL LOCAL EDIT CONSTRAINTS (must obey strictly):
1. You may change ONLY the region indicated by the mask and/or hotspot.
2. Every pixel outside that region must remain visually identical to the input image (same color, texture, lighting, geometry).
3. Do not restyle, recolor, relight, or remodel anything outside the allowed region.
4. Do not change camera, crop, or aspect. Output the full frame at the same size as the input.
5. Prefer seamless blending only at the boundary of the allowed region.`;

const HOTSPOT_SYSTEM = `CRITICAL HOTSPOT OBJECT EDIT (must obey strictly):
1. Identify the single real-world object / material / component under the click point
   (e.g. door, window, chair, planter, tree, facade panel, railing, pavement patch, cushion).
2. Apply the user instruction ONLY to that object (and its immediate attached material).
3. Do NOT change neighboring objects, background, sky, global lighting, color grade, or camera.
4. Preserve exact geometry, edges, and silhouettes of unselected elements.
5. Keep full-frame size identical. Blend seamlessly only at the object boundary.
6. If the instruction is a material/color swap, replace that object's surface convincingly
   while matching the scene's existing light direction and contact shadows.`;

export async function runAiEdit(opts: {
  prompt: string;
  systemHint?: string;
  forceGlobal?: boolean;
  /** Override working image (for sequential multi-point). */
  imageUrl?: string;
  /** Override single hotspot (natural coords). */
  hotspot?: { x: number; y: number } | null;
  /** Override natural-res mask data URL (white/black). */
  naturalMaskUrl?: string;
  /** Skip reading brush mask / store hotspots; use only overrides. */
  isolated?: boolean;
}): Promise<string> {
  const state = useImageStore.getState();
  const current = opts.imageUrl ?? state.currentUrl;
  if (!current) throw new Error('没有可编辑的图片');

  const pad = await padToSupportedRatio(current);
  const size = await loadSize(current);

  let mode: ImageEditPayload['mode'] = 'global';
  let hotspot: ImageEditPayload['hotspot'];
  let maskDataUrl: string | undefined;
  let naturalMaskUrl: string | undefined;
  let local = false;
  let hotspotRoi: Awaited<ReturnType<typeof hotspotRoiAlpha>> | null = null;

  const overrideHotspot =
    opts.hotspot !== undefined ? opts.hotspot : null;
  const useStoreHotspot =
    !opts.isolated && !opts.forceGlobal && state.hotspots.length === 1
      ? state.hotspots[0]
      : null;
  const activeHotspot = overrideHotspot ?? useStoreHotspot;

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
  } else if (!opts.forceGlobal && activeHotspot) {
    // Semantic hotspot edit: let the model pick the object; soft ROI only for composite.
    hotspotRoi = await hotspotRoiAlpha(
      current,
      activeHotspot.x,
      activeHotspot.y,
    );
    naturalMaskUrl = hotspotRoi.maskDataUrl;
    hotspot = pad.mapPoint(activeHotspot.x, activeHotspot.y);
    mode = 'hotspot';
    local = true;
  }

  if (local && mode === 'mask' && !maskDataUrl) {
    throw new Error('局部编辑需要有效的点选或涂抹区域');
  }
  if (local && mode === 'hotspot' && !hotspot) {
    throw new Error('点选编辑需要有效的选点坐标');
  }

  const isHotspot = mode === 'hotspot';
  const systemHint = local
    ? [isHotspot ? HOTSPOT_SYSTEM : LOCAL_SYSTEM, opts.systemHint]
        .filter(Boolean)
        .join('\n\n')
    : opts.systemHint;

  const userPrompt = isHotspot
    ? `Edit the clicked object only.\nUser request: ${opts.prompt}`
    : local
      ? `LOCAL EDIT ONLY — apply this change exclusively inside the allowed region:\n${opts.prompt}`
      : opts.prompt;

  const refs = state.selectedMaterialUrls();
  const result = await requestImageEdit({
    imageDataUrl: pad.dataUrl,
    prompt: userPrompt,
    systemHint,
    mode,
    hotspot: local && activeHotspot ? hotspot : undefined,
    maskDataUrl,
    materialRefs: refs.length ? refs : undefined,
  });

  const cropped = await cropFromPadSized(
    result.imageDataUrl,
    pad.originalCrop,
    pad.canvasW,
    pad.canvasH,
    size.w,
    size.h,
  );

  if (local && hotspotRoi) {
    return compositeHotspotLocal(
      current,
      cropped,
      hotspotRoi.alpha,
      hotspotRoi.w,
      hotspotRoi.h,
    );
  }
  if (local && naturalMaskUrl) {
    return compositeLocalStrict(current, cropped, naturalMaskUrl);
  }
  return cropped;
}

/** Apply each numbered hotspot prompt sequentially on the same image. */
export async function runMultiHotspotEdits(): Promise<string> {
  const state = useImageStore.getState();
  const start = state.currentUrl;
  if (!start) throw new Error('没有可编辑的图片');
  const points = state.hotspots.filter((p) => p.prompt.trim());
  if (!points.length) {
    throw new Error('请至少在一个编号对话框中填写修改要求');
  }

  let current = start;
  for (const p of points) {
    current = await runAiEdit({
      prompt: p.prompt.trim(),
      imageUrl: current,
      hotspot: { x: p.x, y: p.y },
      isolated: true,
    });
  }
  return current;
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
