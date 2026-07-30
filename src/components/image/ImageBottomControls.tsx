import { useMemo, useState } from 'react';
import { convertToPixelCrop, cropToImg } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useAppStore } from '../../store/useAppStore';
import { useImageStore } from '../../image/useImageStore';
import {
  runAiEdit,
  runMultiBrushEdits,
  runMultiHotspotEdits,
} from '../../image/runAiEdit';
import { resizeImage, resizeToMaxSide } from '../../image/padImage';
import {
  PromptRefPlus,
  PromptRefThumbs,
  PromptRefZone,
} from './PromptRefAttach';

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

  const placeholder = useMemo(() => {
    if (brushRegions.length || hasMask) return '描述要在涂抹区域内修改的内容…';
    if (hotspots.length === 1) return '描述要点选位置修改的内容…';
    return '描述全局修改需求，或先点选/涂抹再进行局部编辑…';
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
      const out = await runMultiHotspotEdits();
      // Don't auto-open compare — keep the live canvas so continuous point edits stay precise.
      commitImage(out, { compareFrom: currentUrl, skipCompare: true });
      pushToast(
        `已同步修改 ${hotspots.filter((h) => h.prompt.trim()).length} 处`,
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

  const retouchHint =
    brushRegions.length > 0
      ? '每个独立涂抹区域会编号；橡皮擦可逐个撤销；按住 Shift+左键点击某区域可删除。下方为各区域对应修改要求，点「应用」同步修改。可用 ＋、Ctrl+V 或拖入图片添加参考图（最多 5 张）。'
      : hotspots.length > 0
        ? '按住 Shift 可添加多个选点；再次点击某点可删除；橡皮擦逐个撤销上一点。点选会识别该位置的物体/材质，下方填写对应修改要求后点「应用」。可用 ＋、Ctrl+V 或拖入图片添加参考图（最多 5 张）。'
        : '可以直接输入需求进行全局修改，或点击/涂抹图像进行局部编辑。Shift+点击可多选点；涂抹时不相连区域会自动编号。可用 ＋、Ctrl+V 或拖入图片添加参考图（最多 5 张）。';

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
            <p className="img-tab-hint">{retouchHint}</p>

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
                    <span className="img-hotspot-prompt-num" title={`选点 ${hp.n}`}>
                      {hp.n}
                    </span>
                    <input
                      className="img-prompt-input"
                      value={hp.prompt}
                      onChange={(e) => setHotspotPrompt(hp.id, e.target.value)}
                      placeholder={`选点 ${hp.n} 的修改要求…（可粘贴/拖入参考图）`}
                      disabled={busy}
                    />
                    <PromptRefPlus disabled={busy} />
                    <button
                      type="button"
                      className="btn ghost sm"
                      title="删除该选点"
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
            onApply={() => {
              const official = OFFICIAL_STYLES.find((s) => s.id === selectedStyleId);
              const custom = customStyles.find((s) => s.id === selectedStyleId);
              if (official) run(official.prompt, undefined, true);
              else if (custom)
                run(
                  custom.prompt || `Apply the style of the reference images: ${custom.name}`,
                  undefined,
                  true,
                );
              else pushToast('请先选择一种风格', 'info');
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
  const setCropAspect = useImageStore((s) => s.setCropAspect);
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

  return (
    <div className="img-tab-pane">
      <p className="img-tab-hint">
        在上方主画布拖动选区；可选锁定比例后点击「应用裁剪」。
      </p>
      <div className="img-preset-row">
        {(
          [
            [undefined, '自由'],
            [1, '1:1'],
            [16 / 9, '16:9'],
          ] as const
        ).map(([a, label]) => (
          <button
            key={label}
            type="button"
            className={`btn ghost sm${cropAspect === a ? ' active' : ''}`}
            onClick={() => setCropAspect(a)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="img-gen-btn"
        disabled={busy || applying || !cropSelection?.width}
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
  onApply: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

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
              onClick={() => onSelect(s.id)}
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
                onClick={() => onSelect(s.id)}
              >
                {s.name}
              </button>
              <button
                type="button"
                className="img-style-del"
                title="删除"
                onClick={() => onRemove(s.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="img-prompt-row">
          <input
            className="img-prompt-input"
            placeholder="新风格名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="img-prompt-input"
            placeholder="风格提示词"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              if (!name.trim()) return;
              onUpsert({ name: name.trim(), prompt: desc.trim(), refs: [] });
              setName('');
              setDesc('');
            }}
          >
            新建
          </button>
        </div>
      </div>
      <button type="button" className="img-gen-btn" disabled={busy} onClick={onApply}>
        应用选定风格
      </button>
    </div>
  );
}
