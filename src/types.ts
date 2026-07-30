export type ViewId =
  | 'upload'
  | 'analysis'
  | 'workbench2d'
  | 'build'
  | 'workbench3d'
  | 'image';

export type Dimension = '2D' | '3D';

export type TopologyType = 'triangle' | 'quad';
export type TextureQuality = '2K' | '4K';
export type FaceQuality = 'auto' | 'high' | 'medium' | 'low';
export type EditTool = 'select' | 'move' | 'rotate' | 'scale';

export type SurfaceMode = 'wireframe' | 'solid' | 'shaded' | 'textured';

export type ExportFormat = 'dwf' | 'obj' | 'fbx' | 'skp' | 'rvt' | 'ifc';

export interface Point {
  x: number;
  y: number;
}

export interface MaterialConfig {
  /** display name — synced with the material library swatch when linked */
  name: string;
  /** linked material-library entry id (when painted / matched from library) */
  swatchId?: string;
  preset: string;
  diffuse: string;
  normal: string;
  roughness: string;
  metalness: string;
  resolution: TextureQuality;
}

export interface LayerTransform {
  x: number;
  /** vertical offset from the mesh geometric center */
  y: number;
  z: number;
  scale: number;
  /** rotation around X / Y / Z in radians */
  rx: number;
  ry: number;
  rz: number;
}

export interface Layer {
  id: string;
  /** stable integer used as the label value inside the scene grid */
  key: number;
  name: string;
  category: string;
  dimension: Dimension;
  visible: boolean;
  color: string;
  /** extrusion height in scene units for the 3D model */
  height: number;
  /** rendering archetype for the 3D viewport */
  kind: 'ground' | 'water' | 'vegetation' | 'building' | 'path' | 'generic' | 'sky' | 'mountain';
  material: MaterialConfig;
  /** mesh topology used when extruding this layer to 3D */
  topology: TopologyType;
  /** viewport transform for move / rotate / scale tools */
  transform: LayerTransform;
}

/**
 * The scene footprint produced by the AI. Every grid cell holds the `key` of
 * the layer that owns it (or -1 for empty). Depth is a normalized 0..1 map from
 * the depth-estimation model. Both share the same gridW x gridH resolution.
 */
export interface SceneGrid {
  width: number;
  height: number;
  cells: Int16Array;
  depth: Float32Array;
}

export interface ModelConfig {
  aiModel: string;
  textureGen: boolean;
  textureQuality: TextureQuality;
  pbr: boolean;
  topology: TopologyType;
  /** mesh density when generating 3D massing */
  faceQuality: FaceQuality;
}

export interface OpRecord {
  id: string;
  label: string;
  at: number;
}

export interface MaterialSwatch {
  id: string;
  name: string;
  color: string;
  preset: string;
  normal?: string;
  roughness?: string;
  metalness?: string;
  resolution?: TextureQuality;
}

export interface ViewportSettings {
  grid: boolean;
  surfaceMode: SurfaceMode;
  pbrPreview: boolean;
  /** hemisphere / ambient lighting in the 3D preview */
  ambientLight: boolean;
}

export interface ExportSettings {
  previewStyle: SurfaceMode;
  pbr: boolean;
  format: ExportFormat;
}

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error' | 'warning';
}

/** Viewport camera / history snapshot captured from the 3D canvas */
export interface ModelSnapshot {
  id: string;
  url: string;
  createdAt: number;
  label: string;
  /** Seeded from image→3D handoff; kept as the first snapshot. */
  fromSourceImage?: boolean;
}
