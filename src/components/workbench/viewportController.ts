import type { SnapshotCameraPose } from '../../types';

export type CameraView =
  | 'perspective'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right';

type Handler = (view: CameraView) => void;
type CaptureFn = () => string | null;
type PoseGetter = () => SnapshotCameraPose | null;
type PoseSetter = (pose: SnapshotCameraPose) => void;

let handler: Handler | null = null;
let captureFn: CaptureFn | null = null;
let getPoseFn: PoseGetter | null = null;
let setPoseFn: PoseSetter | null = null;

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
  registerPose(get: PoseGetter, set: PoseSetter) {
    getPoseFn = get;
    setPoseFn = set;
  },
  unregisterPose() {
    getPoseFn = null;
    setPoseFn = null;
  },
  getCameraPose(): SnapshotCameraPose | null {
    return getPoseFn?.() ?? null;
  },
  setCameraPose(pose: SnapshotCameraPose) {
    setPoseFn?.(pose);
  },
};
