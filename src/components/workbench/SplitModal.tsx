import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';
import type { Dimension } from '../../types';

export function SplitModal({
  sourceId,
  onClose,
}: {
  sourceId: string;
  onClose: () => void;
}) {
  const layers = useAppStore((s) => s.layers);
  const splitLayer = useAppStore((s) => s.splitLayer);
  const source = layers.find((l) => l.id === sourceId);
  const [name, setName] = useState(source ? `${source.name}-拆分` : '');
  const [dimension, setDimension] = useState<Dimension>(
    source?.dimension ?? '3D',
  );

  if (!source) return null;

  return (
    <Modal
      title="✂️ 3D 图层拆分"
      subtitle={`从「${source.name}」中拆分出新的组件`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn holo"
            onClick={() => {
              splitLayer(sourceId, name, dimension);
              onClose();
            }}
          >
            确认拆分
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">新图层名称</label>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">图层属性</label>
        <div className="dim-choice">
          <button
            className={`dim-option${dimension === '2D' ? ' active d2' : ''}`}
            onClick={() => setDimension('2D')}
          >
            <b>2D 矢量平面</b>
            <span>平面元素</span>
          </button>
          <button
            className={`dim-option${dimension === '3D' ? ' active d3' : ''}`}
            onClick={() => setDimension('3D')}
          >
            <b>3D 空间实体</b>
            <span>体块元素</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
