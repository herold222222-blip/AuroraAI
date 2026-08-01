import * as THREE from 'three';
import { WORLD_UNIT_METERS } from '../../types';

export function worldToMm(distanceWorld: number): number {
  return distanceWorld * WORLD_UNIT_METERS * 1000;
}

export function worldAreaToM2(areaWorld: number): number {
  return areaWorld * WORLD_UNIT_METERS * WORLD_UNIT_METERS;
}

export function formatMm(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  if (mm >= 100) return `${mm.toFixed(0)} mm`;
  return `${mm.toFixed(1)} mm`;
}

export function formatM2(m2: number): string {
  if (m2 >= 100) return `${m2.toFixed(1)} ㎡`;
  if (m2 >= 1) return `${m2.toFixed(2)} ㎡`;
  return `${m2.toFixed(3)} ㎡`;
}

/** Triangle area in world units from a raycast hit on a mesh. */
export function faceWorldArea(
  mesh: THREE.Mesh,
  face: THREE.Face,
): { area: number; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 } | null {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const pos = geom.attributes.position;
  if (!pos) return null;
  const a = new THREE.Vector3().fromBufferAttribute(pos, face.a);
  const b = new THREE.Vector3().fromBufferAttribute(pos, face.b);
  const c = new THREE.Vector3().fromBufferAttribute(pos, face.c);
  mesh.localToWorld(a);
  mesh.localToWorld(b);
  mesh.localToWorld(c);
  const area = new THREE.Triangle(a, b, c).getArea();
  return { area, a, b, c };
}

export function makeFaceHighlightMesh(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
      3,
    ),
  );
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 998;
  mesh.userData.isMeasureHighlight = true;
  return mesh;
}
