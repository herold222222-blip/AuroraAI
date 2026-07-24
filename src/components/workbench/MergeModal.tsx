import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';

const STRATEGIES = [
  { value: 'keep-base', label: '保留主图层材质' },
  { value: '草坪 / 软质地被', label: '统一为草坪材质' },
  { value: '混凝土 / 白模体块', label: '统一为混凝土白模' },
  { value: '透水铺装', label: '统一为透水铺装' },
];

export function MergeModal({
  sourceIds,
  onClose,
}: {
  sourceIds: string[];
  onClose: () => void;
}) {
  const layers = useAppStore((s) => s.layers);
  const mergeLayers = useAppStore((s) => s.mergeLayers);

  const [ids, setIds] = useState<string[]>(sourceIds);
  const [name, setName] = useState('合并组件');
  const [strategy, setStrategy] = useState('keep-base');

  const selected = layers.filter((l) => ids.includes(l.id));
  const has2D = selected.some((l) => l.dimension === '2D');
  const has3D = selected.some((l) => l.dimension === '3D');
  const mixed = has2D && has3D;

  const remove = (id: string) => setIds((v) => v.filter((x) => x !== id));

  return (
    <Modal
      title="🔗 3D 图层合并"
      subtitle="将多个组件合并为一个汇总图层"
      width={460}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn holo"
            disabled={ids.length < 2}
            onClick={() => {
              mergeLayers(ids, name, strategy);
              onClose();
            }}
          >
            确认合并
          </button>
        </>
      }
    >
      {mixed && (
        <div className="warn-banner">
          ⚠ 检测到同时合并 <b>2D 平面</b> 与 <b>3D 实体</b> 图层，合并后将统一为
          3D 组件，请确认是否继续。
        </div>
      )}

      <div className="field">
        <label className="field-label">待合并图层（{ids.length}）</label>
        <div className="merge-list">
          {selected.map((l) => (
            <div className="merge-item" key={l.id}>
              <span
                className="layer-swatch"
                style={{ background: l.color }}
              />
              <span className="merge-item-name">{l.name}</span>
              <span className={`dim-tag ${l.dimension === '2D' ? 'd2' : 'd3'}`}>
                {l.dimension}
              </span>
              <button
                className="card-tool"
                disabled={ids.length <= 2}
                title="从合并列表移除"
                onClick={() => remove(l.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">合并后名称</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label">材质处理策略</label>
        <select
          className="input"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
        >
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
