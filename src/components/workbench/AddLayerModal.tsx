import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';
import type { Dimension } from '../../types';

export function AddLayerModal({ onClose }: { onClose: () => void }) {
  const addLayer = useAppStore((s) => s.addLayer);
  const [name, setName] = useState('');
  const [dimension, setDimension] = useState<Dimension>('3D');

  const submit = () => {
    addLayer(name || '新建图层', dimension);
    onClose();
  };

  return (
    <Modal
      title="新增图层"
      subtitle="为场景补充一个自定义图层"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn holo" onClick={submit}>
            确认生成
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">图层名称</label>
        <input
          className="input"
          autoFocus
          placeholder="例如：花境组团 / 景观廊架"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
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
            <span>用于铺装、水面等平面元素</span>
          </button>
          <button
            className={`dim-option${dimension === '3D' ? ' active d3' : ''}`}
            onClick={() => setDimension('3D')}
          >
            <b>3D 空间实体</b>
            <span>用于建筑、乔木等体块元素</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
