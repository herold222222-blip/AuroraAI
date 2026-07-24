import { viewportController, type CameraView } from './viewportController';

const CUBE: { view: CameraView; label: string }[] = [
  { view: 'top', label: '顶' },
  { view: 'front', label: '前' },
  { view: 'right', label: '右' },
  { view: 'perspective', label: '透' },
];

export function ViewportChrome() {
  return (
    <div className="vp-chrome">
      <div className="vp-chrome-top">
        <div className="view-cube">
          <div className="view-cube-face">3D</div>
          <div className="view-cube-btns">
            {CUBE.map((c) => (
              <button
                key={c.view}
                onClick={() => viewportController.setView(c.view)}
                title={`${c.label}视图`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
