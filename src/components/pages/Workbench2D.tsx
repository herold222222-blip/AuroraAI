import { LeftPanel } from '../workbench/LeftPanel';
import { Canvas2D } from '../workbench/Canvas2D';
import { LayerManager } from '../workbench/LayerManager';

export function Workbench2D() {
  return (
    <div className="app">
      <div className="workbench">
        <LeftPanel />
        <Canvas2D />
        <LayerManager />
      </div>
    </div>
  );
}
