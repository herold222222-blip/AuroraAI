import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';
import { Switch, Segmented } from '../common/Controls';
import type { ExportFormat, SurfaceMode } from '../../types';

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'dwf', label: 'DWF', hint: 'Autodesk 设计网络格式' },
  { value: 'obj', label: 'OBJ', hint: '通用网格' },
  { value: 'fbx', label: 'FBX', hint: '含材质动画' },
  { value: 'skp', label: 'SKP', hint: 'SketchUp' },
  { value: 'rvt', label: 'RVT', hint: 'Revit' },
  { value: 'ifc', label: 'IFC', hint: 'BIM 标准' },
];

const PREVIEW: { value: SurfaceMode; label: string }[] = [
  { value: 'solid', label: '白模' },
  { value: 'shaded', label: '着色' },
  { value: 'textured', label: '贴图' },
];

function downloadManifest(
  format: ExportFormat,
  layers: { name: string; category: string; dimension: string; height: number }[],
) {
  const lines = [
    '# Aurora exported model manifest',
    `# format: ${format.toUpperCase()}`,
    `# generated: ${new Date().toISOString()}`,
    `# components: ${layers.length}`,
    '',
    ...layers.map(
      (l, i) =>
        `component[${i}] name="${l.name}" category="${l.category}" dim=${l.dimension} height=${l.height}`,
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aurora-model.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const layers = useAppStore((s) => s.layers);
  const config = useAppStore((s) => s.config);
  const settings = useAppStore((s) => s.exportSettings);
  const setSettings = useAppStore((s) => s.setExportSettings);
  const pushToast = useAppStore((s) => s.pushToast);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doExport = () => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      setBusy(false);
      // validation / failure branch
      if (settings.pbr && !config.textureGen) {
        setError(
          '导出校验失败：已开启 PBR 导出，但当前未生成贴图。请关闭 PBR 或先在左侧开启贴图生成后重试。',
        );
        return;
      }
      if (layers.filter((l) => l.visible).length === 0) {
        setError('导出校验失败：当前没有可见组件，请至少保留一个组件后重试。');
        return;
      }
      try {
        downloadManifest(
          settings.format,
          layers.map((l) => ({
            name: l.name,
            category: l.category,
            dimension: l.dimension,
            height: l.height,
          })),
        );
        pushToast('下载成功', 'success');
        onClose();
      } catch {
        setError('导出失败，请更换格式或稍后重试。');
      }
    }, 1000);
  };

  return (
    <Modal
      title="💾 导出模型"
      subtitle="配置导出参数并保存到本地"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn green" disabled={busy} onClick={doExport}>
            {busy ? '正在打包…' : `下载 .${settings.format}`}
          </button>
        </>
      }
    >
      {error && (
        <div className="warn-banner error">
          ✕ {error}
        </div>
      )}

      <div className="cfg-row">
        <span className="cfg-label" style={{ textAlign: 'left' }}>
          模型预览样式
        </span>
        <Segmented
          value={settings.previewStyle === 'wireframe' ? 'solid' : settings.previewStyle}
          onChange={(v: SurfaceMode) => setSettings({ previewStyle: v })}
          options={PREVIEW}
        />
      </div>
      <div className="cfg-row">
        <span className="cfg-label" style={{ textAlign: 'left' }}>
          导出 PBR 材质
        </span>
        <Switch
          checked={settings.pbr}
          onChange={(v) => setSettings({ pbr: v })}
        />
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="field-label">导出文件格式</label>
        <div className="format-grid">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              className={`format-card${
                settings.format === f.value ? ' active' : ''
              }`}
              onClick={() => setSettings({ format: f.value })}
            >
              <b>.{f.value}</b>
              <span>{f.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
