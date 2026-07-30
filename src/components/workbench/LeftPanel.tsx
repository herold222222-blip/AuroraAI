import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { AI_MODELS, resolveAiModel } from '../../data/defaultLayers';
import { Check, Switch, Segmented } from '../common/Controls';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useImageDownloadMenu } from '../common/ImageDownloadContext';
import type { FaceQuality, TopologyType } from '../../types';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024;

const FACE_OPTIONS: { value: FaceQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

const TOPO_OPTIONS: { value: TopologyType; label: string; hint: string }[] = [
  { value: 'triangle', label: '三角面', hint: '兼容性更好，适合通用导出' },
  { value: 'quad', label: '四边面', hint: '利于 Rhino / SketchUp 深化' },
];

interface LeftPanelProps {
  /** show the "rebuild 3D model" button (3D workbench only) */
  showRebuild?: boolean;
}

export function LeftPanel({ showRebuild }: LeftPanelProps) {
  const image = useAppStore((s) => s.image);
  const setImage = useAppStore((s) => s.setImage);
  const clearImage = useAppStore((s) => s.clearImage);
  const resegment = useAppStore((s) => s.resegment);
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const retopologizeAll = useAppStore((s) => s.retopologizeAll);
  const build3D = useAppStore((s) => s.build3D);
  const pushToast = useAppStore((s) => s.pushToast);
  const openDownloadMenu = useImageDownloadMenu();

  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmClearImage, setConfirmClearImage] = useState(false);
  const [drag, setDrag] = useState(false);
  /** Default off: rebuild with existing layers. */
  const [resegmentOnRebuild, setResegmentOnRebuild] = useState(false);

  const acceptFile = (file: File, replacing: boolean) => {
    if (!ACCEPT.includes(file.type)) {
      pushToast('仅支持 JPG / PNG / WEBP 格式图片', 'error');
      return;
    }
    if (file.size > MAX_SIZE) {
      pushToast('单张图片不能超过 20MB', 'error');
      return;
    }
    setImage({
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    });
    // re-run segmentation for the newly uploaded image
    resegment();
    if (replacing) pushToast('已更换图片', 'success');
  };

  return (
    <aside className="panel left">
      <div className="panel-scroll">
        <div className="panel-section">
          <h4>原图</h4>
          {image ? (
            <div className="thumb">
              <img
                src={image.url}
                alt={image.name}
                onContextMenu={(e) =>
                  openDownloadMenu(e, image.url, image.name || 'aurora-source')
                }
              />
              <div className="thumb-mask">
                <button onClick={() => inputRef.current?.click()}>
                  重新上传
                </button>
                <button onClick={() => setConfirmClearImage(true)}>
                  删除图片
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`mini-upload${drag ? ' drag' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) acceptFile(f, false);
              }}
            >
              <div style={{ fontSize: 20 }}>⬆</div>
              <div>点击或拖拽上传新图片</div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f, !!image);
              e.target.value = '';
            }}
          />
        </div>

        <div className="panel-section">
          <h4>模型生成设置</h4>
          <div className="card">
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">AI 模型选择</label>
              <select
                className="input"
                value={resolveAiModel(config.aiModel)}
                onChange={(e) => setConfig({ aiModel: e.target.value })}
              >
                {AI_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="cfg-row">
              <span className="cfg-label">贴图生成</span>
              <Switch
                checked={config.textureGen}
                onChange={(v) => setConfig({ textureGen: v })}
              />
            </div>
            <div className="cfg-row">
              <span className="cfg-label">贴图质量</span>
              <Segmented
                value={config.textureQuality}
                onChange={(v) => setConfig({ textureQuality: v })}
                options={[
                  { value: '2K', label: '2K' },
                  { value: '4K', label: '4K' },
                ]}
              />
            </div>
            <div className="cfg-row">
              <span className="cfg-label">PBR 材质</span>
              <Switch
                checked={config.pbr}
                onChange={(v) => setConfig({ pbr: v })}
              />
            </div>
            <div className="field cfg-topo" style={{ marginTop: 8 }}>
              <label className="field-label">拓扑</label>
              <div className="cfg-topo-list">
                {TOPO_OPTIONS.map((o) => {
                  const active = (config.topology ?? 'triangle') === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={`topo-option${active ? ' active' : ''}`}
                      onClick={() => {
                        if ((config.topology ?? 'triangle') === o.value) return;
                        retopologizeAll(o.value);
                      }}
                    >
                      <span className="topo-option-main">
                        <b>{o.label}</b>
                        {active && <span className="topo-check">✓</span>}
                      </span>
                      <span className="topo-option-hint">{o.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {showRebuild && (
              <div className="field" style={{ marginTop: 4 }}>
                <label className="field-label">面数控制</label>
                <Segmented
                  value={config.faceQuality ?? 'auto'}
                  onChange={(v) => setConfig({ faceQuality: v })}
                  options={FACE_OPTIONS}
                />
              </div>
            )}
          </div>
        </div>

        {showRebuild && (
          <>
            <label className="rebuild-resegment-opt">
              <Check
                checked={resegmentOnRebuild}
                onChange={setResegmentOnRebuild}
              />
              <span>
                是否重新对图片分层
                <em>勾选后先语义分割再重建；默认沿用当前图层</em>
              </span>
            </label>
            <button
              type="button"
              className="btn holo block"
              onClick={() =>
                build3D({ resegmentFirst: resegmentOnRebuild })
              }
              style={{ marginTop: 4 }}
            >
              🚀 重新构建 3D 模型
            </button>
          </>
        )}
      </div>

      {confirmClearImage && (
        <ConfirmDialog
          message="确定删除当前原图？删除后需重新上传。"
          onCancel={() => setConfirmClearImage(false)}
          onConfirm={() => {
            clearImage();
            setConfirmClearImage(false);
            pushToast('已删除图片，请重新上传', 'info');
          }}
        />
      )}
    </aside>
  );
}
