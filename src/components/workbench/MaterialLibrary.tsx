import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { materialsForSelection } from '../../data/defaultLayers';

interface MaterialLibraryProps {
  /** Open PBR inspector for the active library material (no model required). */
  onModify?: (swatchId: string) => void;
}

export function MaterialLibrary({ onModify }: MaterialLibraryProps) {
  const materialTool = useAppStore((s) => s.materialTool);
  const setMaterialTool = useAppStore((s) => s.setMaterialTool);
  const selectPaintMaterial = useAppStore((s) => s.selectPaintMaterial);
  const activePaint = useAppStore((s) => s.activePaint);
  const materialLibrary = useAppStore((s) => s.materialLibrary);
  const layers = useAppStore((s) => s.layers);
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const pushToast = useAppStore((s) => s.pushToast);

  const selectionIds = useMemo(() => {
    if (selectedIds.length) return selectedIds;
    return selectedId ? [selectedId] : [];
  }, [selectedId, selectedIds]);

  const visibleMaterials = useMemo(
    () => materialsForSelection(materialLibrary, layers, selectionIds),
    [materialLibrary, layers, selectionIds],
  );

  const filtered = selectionIds.length > 0;

  const openModify = () => {
    if (!onModify) return;
    if (!activePaint) {
      pushToast('请先选择一种材质', 'info');
      return;
    }
    onModify(activePaint.id);
  };

  return (
    <div className="mat-lib">
      <div className="mat-lib-tools">
        <button
          type="button"
          className={`mat-tool${materialTool === 'eyedropper' ? ' active' : ''}`}
          title="吸管：点击模型面吸取其材质"
          onClick={() =>
            setMaterialTool(materialTool === 'eyedropper' ? 'none' : 'eyedropper')
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M3 21l6-6M14.5 4.5l5 5-9.5 9.5H5v-5L14.5 4.5z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13 6l5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          吸管
        </button>
        <button
          type="button"
          className={`mat-tool${materialTool === 'bucket' ? ' active' : ''}`}
          title="油漆桶：点击模型面应用当前材质"
          onClick={() =>
            setMaterialTool(materialTool === 'bucket' ? 'none' : 'bucket')
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M19 11l-7-7-9 9 7 7 9-9z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M5 13l6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M16 19c0 1.5 1.2 2.5 2.5 2.5S21 20.5 21 19c0-1.5-2.5-3-2.5-3S16 17.5 16 19z"
              fill="currentColor"
              opacity="0.85"
            />
          </svg>
          油漆桶
        </button>
      </div>

      {activePaint && (
        <div className="mat-active-paint">
          <span
            className="mat-swatch-chip"
            style={{ background: activePaint.color }}
            aria-hidden
          />
          <span className="mat-active-label">{activePaint.name}</span>
          {onModify && (
            <button
              type="button"
              className="card-tool mat-modify-btn"
              title="修改材质 / 属性（无需选中模型）"
              onClick={openModify}
            >
              🔧
            </button>
          )}
        </div>
      )}

      <div className="mat-grid">
        {visibleMaterials.map((sw) => {
          const selected = activePaint?.id === sw.id;
          return (
            <button
              key={sw.id}
              type="button"
              className={`mat-swatch${selected ? ' selected' : ''}`}
              title={`选择「${sw.name}」（需用油漆桶涂刷到面上）`}
              onClick={() => selectPaintMaterial(sw)}
            >
              <span className="mat-swatch-chip" style={{ background: sw.color }} />
              <span className="mat-swatch-name">{sw.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mat-hint">
        {filtered
          ? visibleMaterials.length
            ? `已筛选：仅显示当前选中组件使用的 ${visibleMaterials.length} 种材质`
            : '当前选中组件暂无关联材质'
          : '点击色块仅选择材质；使用油漆桶点击模型面进行涂刷。'}
      </p>
    </div>
  );
}
