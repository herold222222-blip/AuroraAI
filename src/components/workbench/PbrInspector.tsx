import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';
import { Segmented } from '../common/Controls';
import { InlineRename } from '../common/InlineRename';
import {
  MATERIAL_PRESETS,
  resolveMaterialDisplayName,
  matchLibrarySwatch,
  swatchToMaterialConfig,
} from '../../data/defaultLayers';
import {
  CONSTRUCTION_PRACTICES,
  type ConstructionPracticeId,
} from '../../data/constructionPractices';
import type { MaterialConfig, TextureQuality } from '../../types';

const CHANNELS: { key: 'diffuse' | 'normal' | 'roughness' | 'metalness'; label: string }[] = [
  { key: 'diffuse', label: '漫反射 Diffuse' },
  { key: 'normal', label: '法线 Normal' },
  { key: 'roughness', label: '粗糙度 Roughness' },
  { key: 'metalness', label: '金属度 Metalness' },
];

const PBR_LIBRARY_MODAL_WIDTH = 1080;

export function PbrInspector({
  layerId,
  swatchId,
  onClose,
}: {
  layerId?: string;
  swatchId?: string;
  onClose: () => void;
}) {
  const layers = useAppStore((s) => s.layers);
  const materialLibrary = useAppStore((s) => s.materialLibrary);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const updateLibraryMaterial = useAppStore((s) => s.updateLibraryMaterial);
  const pushToast = useAppStore((s) => s.pushToast);

  const layer = layerId ? layers.find((l) => l.id === layerId) : undefined;
  const librarySwatch = swatchId
    ? materialLibrary.find((s) => s.id === swatchId)
    : undefined;

  // Library-only edit (no model selection required).
  if (!layer && librarySwatch) {
    const mat = swatchToMaterialConfig(librarySwatch);
    return (
      <Modal
        title="🎨 PBR 材质检查器"
        subtitle={`材质库：${librarySwatch.name}`}
        width={PBR_LIBRARY_MODAL_WIDTH}
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn holo"
              onClick={() => {
                pushToast('材质已保存', 'success');
                onClose();
              }}
            >
              应用修改
            </button>
          </>
        }
      >
        <LibraryEditor
          mat={mat}
          swatchId={librarySwatch.id}
          onRename={(name) => updateLibraryMaterial(librarySwatch.id, { name })}
          onPreset={(preset) => updateLibraryMaterial(librarySwatch.id, { preset })}
          onResolution={(resolution) =>
            updateLibraryMaterial(librarySwatch.id, { resolution })
          }
        />
      </Modal>
    );
  }

  if (!layer) return null;
  const mat = layer.material;
  const materialName = resolveMaterialDisplayName(
    mat,
    materialLibrary,
    layer.color,
  );
  const linkedSwatch = matchLibrarySwatch(materialLibrary, {
    swatchId: mat.swatchId ?? swatchId,
    color: layer.color || mat.diffuse,
    preset: mat.preset,
  });

  return (
    <Modal
      title="🎨 PBR 材质检查器"
      subtitle={`组件：${layer.name}`}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn holo"
            onClick={() => {
              pushToast('材质已应用', 'success');
              onClose();
            }}
          >
            应用修改
          </button>
        </>
      }
    >
      <div className="field pbr-name-field">
        <label className="field-label">材质名称</label>
        <InlineRename
          value={materialName}
          className="pbr-mat-name"
          inputClassName="input pbr-mat-name-input"
          title="点击修改材质名称（与右侧材质库同步）"
          onChange={(name) =>
            updateMaterial(layer.id, {
              name,
              swatchId: linkedSwatch?.id ?? mat.swatchId,
            })
          }
        />
      </div>

      <div className="pbr-grid">
        <div className="pbr-channels">
          {CHANNELS.map((c) => (
            <div className="pbr-channel" key={c.key}>
              <div
                className="pbr-swatch"
                style={{ background: mat[c.key] }}
                title={c.label}
              />
              <span>{c.label}</span>
            </div>
          ))}
        </div>

        <div className="pbr-controls">
          <div className="field">
            <label className="field-label">材质预设</label>
            <select
              className="input"
              value={
                MATERIAL_PRESETS.includes(mat.preset)
                  ? mat.preset
                  : MATERIAL_PRESETS[0]
              }
              onChange={(e) => {
                updateMaterial(layer.id, { preset: e.target.value });
              }}
            >
              {MATERIAL_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">贴图分辨率</label>
            <Segmented
              value={mat.resolution}
              onChange={(v: TextureQuality) =>
                updateMaterial(layer.id, { resolution: v })
              }
              options={[
                { value: '2K', label: '2K' },
                { value: '4K', label: '4K' },
              ]}
            />
          </div>

          <button
            className="btn dark block"
            onClick={() => pushToast('AI 正在重绘贴图……', 'info')}
          >
            🪄 AI 贴图重绘
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LibraryEditor({
  mat,
  swatchId,
  onRename,
  onPreset,
  onResolution,
}: {
  mat: MaterialConfig;
  swatchId: string;
  onRename: (name: string) => void;
  onPreset: (preset: string) => void;
  onResolution: (resolution: TextureQuality) => void;
}) {
  void swatchId;
  const [practiceId, setPracticeId] = useState<ConstructionPracticeId>(
    CONSTRUCTION_PRACTICES[0].id,
  );
  const practice = useMemo(
    () =>
      CONSTRUCTION_PRACTICES.find((p) => p.id === practiceId) ??
      CONSTRUCTION_PRACTICES[0],
    [practiceId],
  );

  return (
    <div className="pbr-library-layout">
      <div className="pbr-library-main">
        <div className="field pbr-name-field">
          <label className="field-label">材质名称</label>
          <InlineRename
            value={mat.name}
            className="pbr-mat-name"
            inputClassName="input pbr-mat-name-input"
            title="点击修改材质名称（与右侧材质库同步）"
            onChange={onRename}
          />
        </div>

        <div className="pbr-grid">
          <div className="pbr-channels">
            {CHANNELS.map((c) => (
              <div className="pbr-channel" key={c.key}>
                <div
                  className="pbr-swatch"
                  style={{ background: mat[c.key] }}
                  title={c.label}
                />
                <span>{c.label}</span>
              </div>
            ))}
          </div>

          <div className="pbr-controls">
            <div className="field">
              <label className="field-label">材质预设</label>
              <select
                className="input"
                value={
                  MATERIAL_PRESETS.includes(mat.preset)
                    ? mat.preset
                    : MATERIAL_PRESETS[0]
                }
                onChange={(e) => onPreset(e.target.value)}
              >
                {MATERIAL_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">贴图分辨率</label>
              <Segmented
                value={mat.resolution}
                onChange={onResolution}
                options={[
                  { value: '2K', label: '2K' },
                  { value: '4K', label: '4K' },
                ]}
              />
            </div>

            <div className="btn dark block pbr-practice-title" aria-hidden="true">
              工程构造做法
            </div>

            <div className="field">
              <select
                className="input"
                value={practiceId}
                onChange={(e) =>
                  setPracticeId(e.target.value as ConstructionPracticeId)
                }
                aria-label="工程构造做法"
              >
                {CONSTRUCTION_PRACTICES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <aside className="pbr-practice-panel" aria-label={`${practice.label}图示`}>
        <div className="pbr-practice-panel-head">{practice.label}</div>
        <figure className="pbr-practice-figure">
          <figcaption>{practice.detailCaption}</figcaption>
          <div className="pbr-practice-frame">
            <img
              src={practice.detailSrc}
              alt={`${practice.label}构造大样`}
              draggable={false}
            />
          </div>
        </figure>
        <figure className="pbr-practice-figure">
          <figcaption>{practice.diagram3dCaption}</figcaption>
          <div className="pbr-practice-frame is-3d">
            <img
              src={practice.diagram3dSrc}
              alt={`${practice.label}三维图解`}
              draggable={false}
            />
          </div>
        </figure>
      </aside>
    </div>
  );
}
