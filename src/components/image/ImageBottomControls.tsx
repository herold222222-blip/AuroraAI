import { useMemo, useRef, useState } from 'react';
import { convertToPixelCrop, cropToImg } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import {
  runAiEdit,
  runMultiBrushEdits,
  runMultiHotspotEdits,
} from '../../image/runAiEdit';
import {
  compressDataUrl,
  resizeImage,
  resizeToMaxSide,
} from '../../image/padImage';
import {
  PromptRefPlus,
  PromptRefThumbs,
  PromptRefZone,
  RefImageLightbox,
} from './PromptRefAttach';
import { IMAGE_EDIT_MODELS } from '../../image/editModels';

const MAX_STYLE_REFS = 50;
const STYLE_REF_API_BUDGET = 4.2 * 1024 * 1024;

const STYLE_TRANSFER_SYSTEM = `CRITICAL FULL-IMAGE STYLE TRANSFER — STRUCTURE LOCK:
1. Restyle ONLY appearance: materials, colors, textures, lighting mood, and aesthetic language.
2. STRICTLY preserve the INPUT image spatial structure: camera angle, perspective, composition, object positions, silhouettes, proportions, and relative layout. Do NOT rearrange, add, remove, or rescale major elements.
3. Do NOT invent new buildings/trees/furniture placements; paint style onto the existing geometry and layout.
4. Style reference images (if any) are appearance guides ONLY — never copy their composition or spatial arrangement onto the input.
5. Output one full-frame image at the SAME size / framing as the input. No borders, captions, or watermarks.`;

function pickStyleRefsForApi(refs: string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const r of refs) {
    if (out.length >= 16) break;
    if (used + r.length > STYLE_REF_API_BUDGET) break;
    out.push(r);
    used += r.length;
  }
  return out;
}

const TABS = [
  { id: 'retouch', label: '改图/修图' },
  { id: 'crop', label: '裁剪' },
  { id: 'adjust', label: '调整尺寸' },
  { id: 'filter', label: '艺术滤镜' },
  { id: 'style', label: '风格迁移' },
] as const;

const OFFICIAL_STYLES = [
  { id: 'neo-chinese', name: '新中式风格', prompt: 'Transform into Neo-Chinese architectural style: refined wood lattice, courtyard calm, ink-wash palette, elegant eaves.' },
  { id: 'modern', name: '现代风格', prompt: 'Transform into contemporary modern style: clean lines, large glazing, minimal ornament, soft neutral palette.' },
  { id: 'luxury', name: '隐奢风格', prompt: 'Transform into quiet luxury style: premium materials, subtle gold accents, deep textures, understated elegance.' },
  { id: 'minimal', name: '极简风格', prompt: 'Transform into minimalist style: sparse composition, white space, simple geometry, muted tones.' },
  { id: 'european', name: '欧式风格', prompt: 'Transform into classic European style: ornate moldings, warm stone, symmetrical facade, soft daylight.' },
  { id: 'islamic', name: '伊斯兰风格', prompt: 'Transform into Islamic architectural style: geometric patterns, arches, intricate screens, serene courtyards.' },
];

export function ImageBottomControls() {
  const tab = useImageStore((s) => s.tab);
  const setTab = useImageStore((s) => s.setTab);
  const prompt = useImageStore((s) => s.prompt);
  const setPrompt = useImageStore((s) => s.setPrompt);
  const hotspots = useImageStore((s) => s.hotspots);
  const setHotspotPrompt = useImageStore((s) => s.setHotspotPrompt);
  const removeHotspot = useImageStore((s) => s.removeHotspot);
  const brushRegions = useImageStore((s) => s.brushRegions);
  const setBrushRegionPrompt = useImageStore((s) => s.setBrushRegionPrompt);
  const removeBrushRegion = useImageStore((s) => s.removeBrushRegion);
  const hasMask = useImageStore((s) => s.hasMask);
  const busy = useImageStore((s) => s.busy);
  const setBusy = useImageStore((s) => s.setBusy);
  const currentUrl = useImageStore((s) => s.currentUrl);
  const commitImage = useImageStore((s) => s.commitImage);
  const customStyles = useImageStore((s) => s.customStyles);
  const selectedStyleId = useImageStore((s) => s.selectedStyleId);
  const setSelectedStyleId = useImageStore((s) => s.setSelectedStyleId);
  const upsertCustomStyle = useImageStore((s) => s.upsertCustomStyle);
  const removeCustomStyle = useImageStore((s) => s.removeCustomStyle);
  const pushToast = useAppStore((s) => s.pushToast);
  const editModel = useImageStore((s) => s.editModel);
  const setEditModel = useImageStore((s) => s.setEditModel);

  const placeholder = useMemo(() => {
    if (brushRegions.length || hasMask) return '描述要在涂抹区域内修改的内容…';
    if (hotspots.length === 1) return '描述要在素描标记处修改的内容…';
    return '描述全局修改需求，或先素描标记/涂抹再进行局部编辑…';
  }, [hasMask, hotspots.length, brushRegions.length]);

  const run = async (p: string, systemHint?: string, forceGlobal?: boolean) => {
    if (!currentUrl) return;
    if (!p.trim()) {
      pushToast('请输入提示词或选择预设', 'info');
      return;
    }
    setBusy(true);
    try {
      const trimmed = p.trim();
      useImageStore.getState().setLastGeneratePrompt(trimmed);
      const out = await runAiEdit({
        prompt: trimmed,
        systemHint,
        forceGlobal,
      });
      const localEdit =
        !forceGlobal &&
        (useImageStore.getState().hotspots.length > 0 ||
          useImageStore.getState().brushRegions.length > 0 ||
          useImageStore.getState().hasMask);
      commitImage(out, {
        compareFrom: currentUrl,
        skipCompare: localEdit,
        prompt: trimmed,
      });
      pushToast('生成完成', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyHotspots = async () => {
    if (!currentUrl) return;
    setBusy(true);
    try {
      const count = hotspots.filter((h) => h.prompt.trim()).length;
      const out = await runMultiHotspotEdits();
      // Don't auto-open compare — keep the live canvas so continuous point edits stay precise.
      commitImage(out, { compareFrom: currentUrl, skipCompare: true });
      // Marks were consumed by the markup pass (Gemini returns a clean photo).
      useImageStore.getState().clearHotspots();
      pushToast(
        count > 1
          ? `已按 Gemini 素描方式一次性修改 ${count} 处标记`
          : '素描修改完成',
        'success',
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyBrushRegions = async () => {
    if (!currentUrl) return;
    setBusy(true);
    try {
      const out = await runMultiBrushEdits();
      commitImage(out, { compareFrom: currentUrl, skipCompare: true });
      pushToast(
        `已同步修改 ${brushRegions.filter((r) => r.prompt.trim()).length} 处涂抹区域`,
        'success',
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="img-controls">
      <div className="img-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="img-tab-body">
        {tab === 'retouch' && (
          <div className="img-tab-pane">
            <div className="img-model-row">
              <span className="img-model-label">选择模型</span>
              <div className="img-model-list" role="radiogroup" aria-label="选择模型">
                {IMAGE_EDIT_MODELS.map((m) => {
                  const active = editModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`img-model-option${active ? ' active' : ''}${
                        m.ready ? '' : ' pending'
                      }`}
                      title={m.hint}
                      onClick={() => setEditModel(m.id)}
                    >
                      <span className="img-model-option-main">
                        <b>{m.label}</b>
                        {active && <span className="img-model-check">✓</span>}
                      </span>
                      {!m.ready && (
                        <span className="img-model-badge">待接入</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {brushRegions.length > 0 ? (
              <PromptRefZone className="img-hotspot-prompts" disabled={busy}>
                {brushRegions.map((br) => (
                  <div key={br.id} className="img-hotspot-prompt-row">
                    <span
                      className="img-hotspot-prompt-num"
                      title={`涂抹区域 ${br.n}`}
                    >
                      {br.n}
                    </span>
                    <input
                      className="img-prompt-input"
                      value={br.prompt}
                      onChange={(e) =>
                        setBrushRegionPrompt(br.id, e.target.value)
                      }
                      placeholder={`涂抹区域 ${br.n} 的修改要求…（可粘贴/拖入参考图）`}
                      disabled={busy}
                    />
                    <PromptRefPlus disabled={busy} />
                    <button
                      type="button"
                      className="btn ghost sm"
                      title="删除该涂抹区域"
                      disabled={busy}
                      onClick={() => removeBrushRegion(br.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <PromptRefThumbs disabled={busy} />
                <button
                  type="button"
                  className="img-gen-btn"
                  disabled={busy}
                  onClick={() => void applyBrushRegions()}
                >
                  {busy ? '应用中…' : '应用'}
                </button>
              </PromptRefZone>
            ) : hotspots.length > 0 ? (
              <PromptRefZone className="img-hotspot-prompts" disabled={busy}>
                {hotspots.map((hp) => (
                  <div key={hp.id} className="img-hotspot-prompt-row">
                    <span className="img-hotspot-prompt-num" title={`标记 ${hp.n}`}>
                      {hp.n}
                    </span>
                    <input
                      className="img-prompt-input"
                      value={hp.prompt}
                      onChange={(e) => setHotspotPrompt(hp.id, e.target.value)}
                      placeholder={`标记 ${hp.n} 的修改要求…（可粘贴/拖入参考图）`}
                      disabled={busy}
                    />
                    <PromptRefPlus disabled={busy} />
                    <button
                      type="button"
                      className="btn ghost sm"
                      title="删除该标记"
                      disabled={busy}
                      onClick={() => removeHotspot(hp.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <PromptRefThumbs disabled={busy} />
                <button
                  type="button"
                  className="img-gen-btn"
                  disabled={busy}
                  onClick={() => void applyHotspots()}
                >
                  {busy ? '应用中…' : '应用'}
                </button>
              </PromptRefZone>
            ) : (
              <PromptRefZone className="img-prompt-stack" disabled={busy}>
                <div className="img-prompt-row">
                  <input
                    className="img-prompt-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={placeholder}
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void run(prompt);
                    }}
                  />
                  <PromptRefPlus disabled={busy} />
                  <button
                    type="button"
                    className="img-gen-btn"
                    disabled={busy}
                    onClick={() => void run(prompt)}
                  >
                    {busy ? '生成中…' : '生成'}
                  </button>
                </div>
                <PromptRefThumbs disabled={busy} />
              </PromptRefZone>
            )}
          </div>
        )}

        {tab === 'crop' && <CropPane busy={busy} />}

        {tab === 'adjust' && (
          <div className="img-tab-pane">
            <div className="img-preset-row">
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={async () => {
                  if (!currentUrl) return;
                  setBusy(true);
                  try {
                    const out = await resizeToMaxSide(currentUrl, 3840);
                    const refined = await runAiEdit({
                      prompt:
                        'Upscale and enhance this image to crisp 4K quality. Preserve composition, materials, and geometry. Increase detail and clarity without inventing new objects.',
                      forceGlobal: true,
                    }).catch(() => out);
                    commitImage(refined, { compareFrom: currentUrl });
                    pushToast('已生成 4K', 'success');
                  } catch (err) {
                    pushToast(err instanceof Error ? err.message : String(err), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                4K
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={async () => {
                  if (!currentUrl) return;
                  setBusy(true);
                  try {
                    const out = await resizeImage(currentUrl, 2);
                    commitImage(out, { compareFrom: currentUrl });
                    pushToast('已扩大一倍', 'success');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                扩大一倍
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={async () => {
                  if (!currentUrl) return;
                  setBusy(true);
                  try {
                    const out = await resizeImage(currentUrl, 0.5);
                    commitImage(out, { compareFrom: currentUrl });
                    pushToast('已缩小一倍', 'success');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                缩小一倍
              </button>
            </div>
            <PromptRefZone className="img-prompt-stack" disabled={busy}>
              <div className="img-prompt-row">
                <input
                  className="img-prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="自定义尺寸/构图调整描述…（可粘贴/拖入参考图）"
                  disabled={busy}
                />
                <PromptRefPlus disabled={busy} />
                <button
                  type="button"
                  className="img-gen-btn"
                  disabled={busy}
                  onClick={() =>
                    run(
                      prompt,
                      'Adjust framing/scale as requested while keeping subject integrity.',
                      true,
                    )
                  }
                >
                  应用调整
                </button>
              </div>
              <PromptRefThumbs disabled={busy} />
            </PromptRefZone>
          </div>
        )}

        {tab === 'filter' && (
          <div className="img-tab-pane">
            <div className="img-preset-group">
              <span className="img-preset-label">光影氛围</span>
              <div className="img-preset-row">
                {[
                  ['一键夜景', 'Convert to a realistic night scene: warm interior lights and street lamps, high-contrast night sky, keep architecture structure identical.'],
                  ['一键白天', 'Convert to natural daytime with clear sunlight and blue sky. Keep geometry identical.'],
                  ['一键黄昏', 'Convert to warm golden-hour dusk with long soft shadows. Keep geometry identical.'],
                ].map(([label, p]) => (
                  <button
                    key={label}
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => run(p, undefined, true)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="img-preset-group">
              <span className="img-preset-label">四季变换</span>
              <div className="img-preset-row">
                {[
                  ['春', 'Spring: fresh greenery and soft bloom light. Keep buildings unchanged.'],
                  ['夏', 'Summer: high-saturation lush greens and strong sun. Keep buildings unchanged.'],
                  ['秋', 'Autumn: golden and maple-red foliage tones. Keep buildings unchanged.'],
                  [
                    '冬',
                    'Winter natural snow scene. CRITICAL: only place snow on flat ground, roofs, and tree branches. Strictly preserve building facades, walls, wood and stone original colors and textures — do NOT cover vertical walls with snow.',
                  ],
                ].map(([label, p]) => (
                  <button
                    key={label}
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => run(p, undefined, true)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <PromptRefZone className="img-prompt-stack" disabled={busy}>
              <div className="img-prompt-row">
                <input
                  className="img-prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="自定义滤镜描述…（可粘贴/拖入参考图）"
                  disabled={busy}
                />
                <PromptRefPlus disabled={busy} />
                <button
                  type="button"
                  className="img-gen-btn"
                  disabled={busy}
                  onClick={() => run(prompt, undefined, true)}
                >
                  应用滤镜
                </button>
              </div>
              <PromptRefThumbs disabled={busy} />
            </PromptRefZone>
          </div>
        )}

        {tab === 'style' && (
          <StylePane
            busy={busy}
            official={OFFICIAL_STYLES}
            custom={customStyles}
            selectedId={selectedStyleId}
            onSelect={setSelectedStyleId}
            onUpsert={upsertCustomStyle}
            onRemove={removeCustomStyle}
            onApply={async () => {
              const official = OFFICIAL_STYLES.find(
                (s) => s.id === selectedStyleId,
              );
              const custom = customStyles.find((s) => s.id === selectedStyleId);
              if (official) {
                await run(official.prompt, STYLE_TRANSFER_SYSTEM, true);
                return;
              }
              if (custom) {
                const refs = pickStyleRefsForApi(custom.refs || []);
                const styleDesc =
                  custom.prompt.trim() ||
                  `Match the visual style of the attached reference images (${custom.name}).`;
                const prompt = [
                  `Style name: ${custom.name}`,
                  styleDesc,
                  'STRUCTURE LOCK: Keep the original image spatial layout, camera, perspective, object positions and silhouettes EXACTLY. Only transfer style appearance (materials / colors / textures / lighting mood). Do not rearrange the scene.',
                ].join('\n');
                if (!currentUrl) return;
                if (!custom.prompt.trim() && !refs.length) {
                  pushToast('请为该风格填写描述词或上传参考图', 'info');
                  return;
                }
                setBusy(true);
                try {
                  const trimmed = prompt.trim();
                  useImageStore.getState().setLastGeneratePrompt(trimmed);
                  const out = await runAiEdit({
                    prompt: trimmed,
                    systemHint: STYLE_TRANSFER_SYSTEM,
                    forceGlobal: true,
                    materialRefs: refs,
                  });
                  commitImage(out, {
                    compareFrom: currentUrl,
                    skipCompare: false,
                    prompt: trimmed,
                  });
                  pushToast(
                    refs.length
                      ? `风格迁移完成（参考图 ${refs.length} 张）`
                      : '风格迁移完成',
                    'success',
                  );
                } catch (err) {
                  pushToast(
                    err instanceof Error ? err.message : String(err),
                    'error',
                  );
                } finally {
                  setBusy(false);
                }
                return;
              }
              pushToast('请先选择一种风格', 'info');
            }}
          />
        )}
      </div>
    </div>
  );
}

function CropPane({ busy }: { busy: boolean }) {
  const currentUrl = useImageStore((s) => s.currentUrl);
  const commitImage = useImageStore((s) => s.commitImage);
  const cropAspect = useImageStore((s) => s.cropAspect);
  const cropGuideVisible = useImageStore((s) => s.cropGuideVisible);
  const toggleCropGuide = useImageStore((s) => s.toggleCropGuide);
  const cropSelection = useImageStore((s) => s.cropSelection);
  const pushToast = useAppStore((s) => s.pushToast);
  const [applying, setApplying] = useState(false);

  if (!currentUrl) return null;

  const applyCrop = async () => {
    const img = document.querySelector(
      '.img-crop-target',
    ) as HTMLImageElement | null;
    if (!img || !cropSelection?.width || !cropSelection?.height) {
      pushToast('请先在画面上框选裁剪区域', 'info');
      return;
    }
    setApplying(true);
    try {
      const pixel = convertToPixelCrop(
        cropSelection,
        img.width,
        img.height,
      );
      if (pixel.width < 2 || pixel.height < 2) {
        pushToast('裁剪区域过小', 'info');
        return;
      }
      const url = await cropToImg(img, pixel);
      commitImage(url, { skipCompare: true });
      pushToast('已应用裁剪', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '裁剪失败', 'error');
    } finally {
      setApplying(false);
    }
  };

  const presets: { key: string; label: string; value: typeof cropAspect }[] = [
    { key: 'original', label: '锁定原图比例', value: 'original' },
    { key: 'free', label: '自由', value: undefined },
    { key: '1:1', label: '1:1', value: 1 },
    { key: '4:3', label: '4:3', value: 4 / 3 },
    { key: '16:9', label: '16:9', value: 16 / 9 },
  ];

  return (
    <div className="img-tab-pane">
      <p className="img-tab-hint">
        在上方主画布拖动选区；再次点击当前比例可隐藏/显示裁剪框，切换其他比例会重新显示。
      </p>
      <div className="img-preset-row">
        {presets.map(({ key, label, value }) => (
          <button
            key={key}
            type="button"
            className={`btn ghost sm${
              cropAspect === value && cropGuideVisible ? ' active' : ''
            }`}
            title={
              cropAspect === value && cropGuideVisible
                ? '再次点击隐藏裁剪框'
                : '显示裁剪框'
            }
            onClick={() => toggleCropGuide(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="img-gen-btn"
        disabled={busy || applying || !cropGuideVisible || !cropSelection?.width}
        onClick={() => void applyCrop()}
      >
        {applying ? '裁剪中…' : '应用裁剪'}
      </button>
    </div>
  );
}

function StylePane({
  busy,
  official,
  custom,
  selectedId,
  onSelect,
  onUpsert,
  onRemove,
  onApply,
}: {
  busy: boolean;
  official: { id: string; name: string; prompt: string }[];
  custom: { id: string; name: string; prompt: string; refs: string[] }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpsert: (s: {
    id?: string;
    name: string;
    prompt: string;
    refs: string[];
  }) => void;
  onRemove: (id: string) => void;
  onApply: () => void | Promise<void>;
}) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCustom = custom.find((s) => s.id === selectedId) ?? null;

  const resetForm = () => {
    setName('');
    setDesc('');
    setRefs([]);
    setEditingId(null);
    setFormOpen(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const startCreate = () => {
    setEditingId(null);
    setName('');
    setDesc('');
    setRefs([]);
    setFormOpen(true);
  };

  const startEdit = (s: {
    id: string;
    name: string;
    prompt: string;
    refs: string[];
  }) => {
    onSelect(s.id);
    setEditingId(s.id);
    setName(s.name);
    setDesc(s.prompt);
    setRefs([...(s.refs || [])]);
    setFormOpen(true);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_STYLE_REFS - refs.length;
    if (room <= 0) {
      pushToast(`参考图最多 ${MAX_STYLE_REFS} 张`, 'info');
      return;
    }
    const list = Array.from(files).slice(0, room);
    setSaving(true);
    try {
      const next: string[] = [];
      for (const file of list) {
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('读取失败'));
          reader.readAsDataURL(file);
        });
        next.push(await compressDataUrl(dataUrl, 768, 0.7));
      }
      if (!next.length) {
        pushToast('请选择图片文件', 'info');
        return;
      }
      setRefs((prev) => [...prev, ...next].slice(0, MAX_STYLE_REFS));
      if (list.length < files.length) {
        pushToast(`已达上限，仅添加 ${list.length} 张`, 'info');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '上传失败', 'error');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveStyle = () => {
    if (!name.trim()) {
      pushToast('请填写风格名称', 'info');
      return;
    }
    if (!desc.trim() && refs.length === 0) {
      pushToast('请填写描述词或上传至少一张参考图', 'info');
      return;
    }
    onUpsert({
      id: editingId || undefined,
      name: name.trim(),
      prompt: desc.trim(),
      refs,
    });
    pushToast(
      editingId
        ? `已更新风格「${name.trim()}」`
        : `已保存风格「${name.trim()}」`,
      'success',
    );
    resetForm();
  };

  const renderRefGrid = (
    urls: string[],
    opts?: { removable?: boolean },
  ) => (
    <div className="img-style-ref-grid">
      {urls.map((url, i) => (
        <div key={`${i}-${url.slice(-16)}`} className="img-style-ref-thumb">
          <button
            type="button"
            className="img-style-ref-open"
            title={`点击放大 图${i + 1}`}
            onClick={() =>
              setPreview({ url, label: `参考图 ${i + 1}` })
            }
          >
            <img src={url} alt={`参考 ${i + 1}`} />
          </button>
          {opts?.removable && (
            <button
              type="button"
              className="img-style-ref-del"
              title="移除"
              onClick={() =>
                setRefs((prev) => prev.filter((_, j) => j !== i))
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="img-tab-pane">
      <div className="img-preset-group">
        <span className="img-preset-label">官方预设</span>
        <div className="img-preset-row wrap">
          {official.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`btn ghost sm${selectedId === s.id ? ' active' : ''}`}
              aria-pressed={selectedId === s.id}
              onClick={() =>
                onSelect(selectedId === s.id ? null : s.id)
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="img-preset-group">
        <span className="img-preset-label">我的自定义风格</span>
        <div className="img-preset-row wrap">
          {custom.map((s) => (
            <span key={s.id} className="img-style-chip">
              <button
                type="button"
                className={`btn ghost sm${selectedId === s.id ? ' active' : ''}`}
                aria-pressed={selectedId === s.id}
                title={
                  s.refs?.length
                    ? `${s.name}（${s.refs.length} 张参考图）`
                    : s.name
                }
                onClick={() =>
                  onSelect(selectedId === s.id ? null : s.id)
                }
              >
                {s.name}
                {s.refs?.length ? (
                  <span className="img-style-ref-count">{s.refs.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="img-style-edit"
                title="修改"
                onClick={() => startEdit(s)}
              >
                改
              </button>
              <button
                type="button"
                className="img-style-del"
                title="删除"
                onClick={() => {
                  if (editingId === s.id) resetForm();
                  onRemove(s.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
          {!formOpen && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={startCreate}
            >
              ＋ 新建
            </button>
          )}
        </div>

        {selectedCustom && !formOpen && (selectedCustom.refs?.length ?? 0) > 0 && (
          <div className="img-style-selected-refs">
            <span className="img-style-upload-hint">
              「{selectedCustom.name}」参考图（点击放大）
            </span>
            {renderRefGrid(selectedCustom.refs)}
          </div>
        )}

        {formOpen && (
          <div className="img-style-create">
            <div className="img-style-create-title">
              {editingId ? '修改自定义风格' : '新建自定义风格'}
            </div>
            <input
              className="img-prompt-input"
              placeholder="风格名称（必填）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy || saving}
            />
            <textarea
              className="img-prompt-input img-style-desc"
              placeholder="描述词：说明目标风格、材质、色调、氛围等（可选，有参考图时更准）"
              value={desc}
              rows={3}
              onChange={(e) => setDesc(e.target.value)}
              disabled={busy || saving}
            />
            <div className="img-style-upload-row">
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy || saving || refs.length >= MAX_STYLE_REFS}
                onClick={() => fileRef.current?.click()}
              >
                {saving
                  ? '上传中…'
                  : `上传参考图（${refs.length}/${MAX_STYLE_REFS}）`}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
              <span className="img-style-upload-hint">
                支持多选，最多 {MAX_STYLE_REFS} 张；点击缩略图可放大
              </span>
            </div>
            {refs.length > 0 && renderRefGrid(refs, { removable: true })}
            <div className="img-style-create-actions">
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy || saving}
                onClick={resetForm}
              >
                取消
              </button>
              <button
                type="button"
                className="btn holo sm"
                disabled={busy || saving}
                onClick={saveStyle}
              >
                {editingId ? '保存修改' : '保存风格'}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="img-gen-btn"
        disabled={busy || !selectedId}
        onClick={() => void onApply()}
      >
        应用选定风格
      </button>

      {preview && (
        <RefImageLightbox
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
