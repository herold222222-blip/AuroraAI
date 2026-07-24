export type CameraView =
  | 'perspective'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right';

type Handler = (view: CameraView) => void;
type CaptureFn = () => string | null;

let handler: Handler | null = null;
let captureFn: CaptureFn | null = null;

export const viewportController = {
  register(fn: Handler) {
    handler = fn;
  },
  unregister() {
    handler = null;
  },
  setView(view: CameraView) {
    handler?.(view);
  },
  registerCapture(fn: CaptureFn) {
    captureFn = fn;
  },
  unregisterCapture() {
    captureFn = null;
  },
  /** Force a fresh render, then export the WebGL canvas as a PNG data URL. */
  captureSnapshot(): string | null {
    return captureFn?.() ?? null;
  },
};
