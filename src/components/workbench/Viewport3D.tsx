import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useAppStore } from '../../store/useAppStore';
import type { EditTool, Layer, SurfaceMode, ViewportSettings } from '../../types';
import { viewportController, type CameraView } from './viewportController';
import { buildMassing } from './buildMassing';

function tint(hex: string, mode: SurfaceMode): THREE.Color {
  if (mode === 'solid') return new THREE.Color('#f2f4f6');
  const c = new THREE.Color(hex);
  if (mode === 'textured') return c;
  return c.clone().lerp(new THREE.Color('#f4f6f8'), 0.68);
}

function makeMaterial(
  layer: Layer,
  vp: ViewportSettings,
  selected: boolean,
): THREE.Material {
  const color = tint(layer.color, vp.surfaceMode);
  if (vp.surfaceMode === 'wireframe') {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(layer.color),
      wireframe: true,
    });
  }
  if (vp.surfaceMode === 'solid') {
    const mat = new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    if (selected) {
      mat.emissive = new THREE.Color(0x00d2ff);
      mat.emissiveIntensity = 0.22;
    }
    return mat;
  }
  const isWater = layer.kind === 'water';
  const isBuilding = layer.kind === 'building';
  const mat = new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    roughness: vp.pbrPreview ? (isWater ? 0.12 : isBuilding ? 0.55 : 0.9) : 0.95,
    metalness: vp.pbrPreview ? (isWater ? 0.55 : isBuilding ? 0.12 : 0.02) : 0,
    transparent: isWater,
    opacity: isWater ? 0.8 : 1,
    flatShading: true,
  });
  if (selected) {
    mat.emissive = new THREE.Color(0x00d2ff);
    mat.emissiveIntensity = 0.28;
  }
  return mat;
}

function layerTransform(layer: Layer) {
  const t = layer.transform ?? {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    rx: 0,
    ry: 0,
    rz: 0,
  };
  return {
    x: t.x,
    y: t.y ?? 0,
    z: t.z,
    scale: t.scale,
    rx: t.rx ?? 0,
    ry: t.ry ?? 0,
    rz: t.rz ?? 0,
  };
}

/** Pivot at geometric center so move / rotate gizmo sits on the massing. */
function applyPivotTransform(
  pivot: THREE.Object3D,
  layer: Layer,
  geomCenter: THREE.Vector3,
) {
  const t = layerTransform(layer);
  pivot.position.set(
    geomCenter.x + t.x,
    geomCenter.y + t.y,
    geomCenter.z + t.z,
  );
  pivot.rotation.set(t.rx, t.ry, t.rz);
  pivot.scale.setScalar(t.scale);
}

function createMoveCenterBall(): THREE.Mesh {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  ball.name = 'moveCenterBall';
  ball.renderOrder = 1000;
  // Let TransformControls handle picking on the XYZ center handle underneath.
  ball.raycast = () => {};
  return ball;
}

export function Viewport3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | undefined>(undefined);
  const cameraRef = useRef<THREE.PerspectiveCamera | undefined>(undefined);
  const controlsRef = useRef<OrbitControls | undefined>(undefined);
  const rendererRef = useRef<THREE.WebGLRenderer | undefined>(undefined);
  const groupRef = useRef<THREE.Group | undefined>(undefined);
  const meshyGroupRef = useRef<THREE.Group | undefined>(undefined);
  const gridRef = useRef<THREE.GridHelper | undefined>(undefined);
  const hemiRef = useRef<THREE.HemisphereLight | undefined>(undefined);
  const fillRef = useRef<THREE.DirectionalLight | undefined>(undefined);
  const keyLightRef = useRef<THREE.DirectionalLight | undefined>(undefined);
  const shadowPlaneRef = useRef<THREE.Mesh | undefined>(undefined);
  const transformRef = useRef<TransformControls | undefined>(undefined);
  const moveBallRef = useRef<THREE.Mesh | undefined>(undefined);
  const rafRef = useRef<number>(0);

  const grid = useAppStore((s) => s.grid);
  const layers = useAppStore((s) => s.layers);
  const viewport = useAppStore((s) => s.viewport);
  const selectedId = useAppStore((s) => s.selectedLayerId);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const selectLayer = useAppStore((s) => s.selectLayer);
  const faceQuality = useAppStore((s) => s.config.faceQuality);
  const meshyModelUrl = useAppStore((s) => s.meshyModelUrl);
  const materialTool = useAppStore((s) => s.materialTool);
  const sampleMaterialFromLayer = useAppStore((s) => s.sampleMaterialFromLayer);
  const applyPaintToLayer = useAppStore((s) => s.applyPaintToLayer);
  const editTool = useAppStore((s) => s.editTool);
  const updateLayerTransform = useAppStore((s) => s.updateLayerTransform);

  const materialToolRef = useRef(materialTool);
  const sampleRef = useRef(sampleMaterialFromLayer);
  const paintRef = useRef(applyPaintToLayer);
  const selectRef = useRef(selectLayer);
  const toolRef = useRef<EditTool>(editTool);
  const selectedRef = useRef(selectedId);
  const selectedIdsRef = useRef(selectedIds);
  const updateXfRef = useRef(updateLayerTransform);
  const layersRef = useRef(layers);

  materialToolRef.current = materialTool;
  sampleRef.current = sampleMaterialFromLayer;
  paintRef.current = applyPaintToLayer;
  selectRef.current = selectLayer;
  toolRef.current = editTool;
  selectedRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  updateXfRef.current = updateLayerTransform;
  layersRef.current = layers;

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(12, 11, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 0.5, 0);
    // Left = select only (custom handlers). Orbit moved to middle; pan stays on right.
    // -1 disables OrbitControls for that button (falls through to no-op).
    controls.mouseButtons = {
      LEFT: -1 as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xdfe6ee, 0.85);
    scene.add(hemi);
    hemiRef.current = hemi;
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(9, 16, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.bias = -0.0004;
    scene.add(key);
    keyLightRef.current = key;
    const fill = new THREE.DirectionalLight(0xbfe6ff, 0.3);
    fill.position.set(-8, 6, -8);
    scene.add(fill);
    fillRef.current = fill;

    scene.background = new THREE.Color('#eef3f8');

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.14 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.02;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);
    shadowPlaneRef.current = shadowPlane;

    const gridHelper = new THREE.GridHelper(48, 48, 0xc9d2dc, 0xe4e9ef);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.55;
    scene.add(gridHelper);
    gridRef.current = gridHelper;

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const meshyGroup = new THREE.Group();
    scene.add(meshyGroup);
    meshyGroupRef.current = meshyGroup;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate');
    transform.setSpace('world');
    transform.setSize(0.95);
    transform.enabled = false;
    transform.getHelper().visible = false;
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const moveBall = createMoveCenterBall();
    moveBall.visible = false;
    scene.add(moveBall);
    moveBallRef.current = moveBall;

    const syncMoveBall = () => {
      const obj = transform.object;
      const show =
        toolRef.current === 'move' &&
        Boolean(obj) &&
        transform.getHelper().visible;
      moveBall.visible = show;
      if (!show || !obj) return;
      obj.getWorldPosition(moveBall.position);
      const dist = camera.position.distanceTo(moveBall.position);
      const s = Math.max(0.35, dist * 0.018);
      moveBall.scale.setScalar(s);
    };

    /** Whether move/rotate gizmo is currently attached for interaction. */
    let gizmoArmed = false;

    const armGizmo = (on: boolean) => {
      gizmoArmed = on;
      // Keep TransformControls disabled until the pointer actually hits the
      // gizmo — otherwise every canvas click steals pointer capture and can
      // permanently freeze the HTML toolbar when enabled flips mid-gesture.
      if (!on) transform.enabled = false;
    };

    const releasePointer = (pointerId?: number) => {
      if (pointerId != null) {
        try {
          renderer.domElement.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
      }
      controls.enabled = true;
      if (gizmoArmed && !transform.dragging) {
        // stay disabled until next gizmo hit; hover is optional
        transform.enabled = false;
      }
    };

    transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(
        (event as unknown as { value: boolean }).value,
      );
      controls.enabled = !dragging;
      if (dragging) return;

      releasePointer();

      const obj = transform.object;
      if (!obj) return;
      const id = obj.userData.layerId as string | undefined;
      const center = obj.userData.geomCenter as THREE.Vector3 | undefined;
      if (!id || !center) return;

      const mode = transform.getMode();
      if (mode === 'translate') {
        updateXfRef.current(
          id,
          {
            x: obj.position.x - center.x,
            y: obj.position.y - center.y,
            z: obj.position.z - center.z,
          },
          { commit: true, label: '移动组件' },
        );
      } else if (mode === 'rotate') {
        updateXfRef.current(
          id,
          {
            rx: obj.rotation.x,
            ry: obj.rotation.y,
            rz: obj.rotation.z,
          },
          { commit: true, label: '旋转组件' },
        );
      }
    });

    transform.addEventListener('change', syncMoveBall);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };
    let dragging = false;
    let dragMoved = false;
    let dragId: string | null = null;
    let dragMode: 'scale' | 'free' | null = null;
    let dragStart = {
      x: 0,
      y: 0,
      z: 0,
      scale: 1,
      py: 0,
      hx: 0,
      hy: 0,
      hz: 0,
    };

    const setPointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickLayerId = (): string | null => {
      const hits = raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          const id = obj.userData.layerId as string | undefined;
          if (id) return id;
          obj = obj.parent;
        }
      }
      return null;
    };

    const hitsGizmoHelper = (): boolean => {
      if (!gizmoArmed || !transform.getHelper().visible) return false;
      return raycaster.intersectObject(transform.getHelper(), true).length > 0;
    };

    const hitsMoveBall = (): boolean => {
      if (!moveBall.visible) return false;
      const prev = moveBall.raycast;
      moveBall.raycast = THREE.Mesh.prototype.raycast;
      const hits = raycaster.intersectObject(moveBall, false);
      moveBall.raycast = prev;
      return hits.length > 0;
    };

    // Capture phase: enable TransformControls only when clicking axis handles,
    // so empty-canvas clicks never call setPointerCapture (which freezes UI).
    const onDownCapture = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!gizmoArmed || transform.dragging) return;
      setPointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (hitsMoveBall()) {
        transform.enabled = false;
        return;
      }
      transform.enabled = hitsGizmoHelper();
    };

    const freePlane = new THREE.Plane();
    const hitPoint = new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    const onDown = (e: PointerEvent) => {
      // Block browser middle-click autoscroll; orbit is handled by OrbitControls.
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      downPos = { x: e.clientX, y: e.clientY };
      if (materialToolRef.current !== 'none') return;
      if (transform.dragging) return;

      setPointer(e);
      raycaster.setFromCamera(pointer, camera);

      // Center ball → free move on the camera-facing plane.
      if (toolRef.current === 'move' && hitsMoveBall() && transform.object) {
        const obj = transform.object;
        const id = obj.userData.layerId as string | undefined;
        const center = obj.userData.geomCenter as THREE.Vector3 | undefined;
        if (!id || !center) return;
        obj.getWorldPosition(worldPos);
        camera.getWorldDirection(camDir);
        freePlane.setFromNormalAndCoplanarPoint(camDir, worldPos);
        if (!raycaster.ray.intersectPlane(freePlane, hitPoint)) return;
        dragging = true;
        dragMoved = false;
        dragMode = 'free';
        dragId = id;
        dragStart = {
          x: obj.position.x - center.x,
          y: obj.position.y - center.y,
          z: obj.position.z - center.z,
          scale: obj.scale.x,
          py: e.clientY,
          hx: hitPoint.x,
          hy: hitPoint.y,
          hz: hitPoint.z,
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }

      // Scale keeps free vertical drag on the mesh.
      if (toolRef.current !== 'scale') return;

      const id = pickLayerId();
      if (!id) return;

      const sel =
        selectedIdsRef.current.length > 0
          ? selectedIdsRef.current
          : selectedRef.current
            ? [selectedRef.current]
            : [];
      if (!sel.includes(id)) selectRef.current(id, e.shiftKey);
      else if (e.shiftKey) selectRef.current(id, true);

      const layer = layersRef.current.find((l) => l.id === id);
      if (!layer) return;
      const t = layerTransform(layer);

      dragging = true;
      dragMoved = false;
      dragMode = 'scale';
      dragId = id;
      dragStart = {
        x: t.x,
        y: t.y,
        z: t.z,
        scale: t.scale,
        py: e.clientY,
        hx: 0,
        hy: 0,
        hz: 0,
      };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging || !dragId || !dragMode) return;

      if (dragMode === 'free') {
        setPointer(e);
        raycaster.setFromCamera(pointer, camera);
        if (!raycaster.ray.intersectPlane(freePlane, hitPoint)) return;
        const obj = transform.object;
        const center = obj?.userData.geomCenter as THREE.Vector3 | undefined;
        if (!obj || !center) return;
        dragMoved = true;
        obj.position.set(
          center.x + dragStart.x + (hitPoint.x - dragStart.hx),
          center.y + dragStart.y + (hitPoint.y - dragStart.hy),
          center.z + dragStart.z + (hitPoint.z - dragStart.hz),
        );
        return;
      }

      if (!dragMoved) {
        dragMoved = true;
        updateXfRef.current(
          dragId,
          { scale: dragStart.scale },
          { commit: true, label: '缩放组件' },
        );
      }
      const dy = (dragStart.py - e.clientY) * 0.01;
      updateXfRef.current(
        dragId,
        { scale: dragStart.scale * (1 + dy) },
        { commit: false },
      );
    };

    const onUp = (e: PointerEvent) => {
      if (dragging && dragId) {
        const wasFree = dragMode === 'free';
        const id = dragId;
        const obj = transform.object;
        const center = obj?.userData.geomCenter as THREE.Vector3 | undefined;
        const moved = dragMoved;
        dragging = false;
        dragId = null;
        dragMode = null;
        dragMoved = false;
        releasePointer(e.pointerId);
        if (wasFree && moved && obj && center) {
          updateXfRef.current(
            id,
            {
              x: obj.position.x - center.x,
              y: obj.position.y - center.y,
              z: obj.position.z - center.z,
            },
            { commit: true, label: '移动组件' },
          );
        }
        return;
      }

      if (e.button !== 0) return;
      if (transform.dragging) return;

      // Clear a stuck capture from TransformControls without fighting an active drag.
      releasePointer(e.pointerId);

      const moved =
        Math.abs(e.clientX - downPos.x) + Math.abs(e.clientY - downPos.y);
      if (moved > 5) return;

      setPointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (hitsGizmoHelper() || hitsMoveBall()) return;

      const id = pickLayerId();
      if (id) {
        const matTool = materialToolRef.current;
        if (matTool === 'eyedropper') sampleRef.current(id);
        else if (matTool === 'bucket') paintRef.current(id);
        else selectRef.current(id, e.shiftKey);
      } else if (materialToolRef.current === 'none' && !e.shiftKey) {
        selectRef.current(null);
      }
    };

    const onAuxClick = (e: MouseEvent) => {
      // Prevent middle-button default (auto-scroll) on the canvas.
      if (e.button === 1) e.preventDefault();
    };

    const onWindowUp = (e: PointerEvent) => {
      // Only used to recover from a stuck pointer capture; never interrupt drags.
      if (transform.dragging || dragging) return;
      releasePointer(e.pointerId);
    };

    // Expose armGizmo for the attach effect via the transform ref object.
    (transform as unknown as { __armGizmo?: (on: boolean) => void }).__armGizmo =
      armGizmo;

    renderer.domElement.addEventListener('pointerdown', onDownCapture, true);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onWindowUp);
    renderer.domElement.addEventListener('auxclick', onAuxClick);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);

    const ro = new ResizeObserver(() => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);

    const animate = () => {
      controls.update();
      syncMoveBall();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    const R = 22;
    const VIEWS: Record<CameraView, [number, number, number]> = {
      perspective: [12, 11, 15],
      top: [0.001, R, 0.001],
      front: [0, 5, R],
      back: [0, 5, -R],
      left: [-R, 5, 0],
      right: [R, 5, 0],
    };
    viewportController.register((view) => {
      const [x, y, z] = VIEWS[view];
      camera.position.set(x, y, z);
      controls.target.set(0, 0.5, 0);
      controls.update();
    });
    viewportController.registerPose(
      () => ({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      }),
      (pose) => {
        // Kill residual orbit damping so the restored pose sticks.
        const orbit = controls as OrbitControls & {
          _sphericalDelta: THREE.Spherical;
          _panOffset: THREE.Vector3;
        };
        orbit._sphericalDelta.set(0, 0, 0);
        orbit._panOffset.set(0, 0, 0);
        camera.position.set(
          pose.position[0],
          pose.position[1],
          pose.position[2],
        );
        controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
        controls.update();
      },
    );
    viewportController.registerCapture(() => {
      controls.update();
      syncMoveBall();
      renderer.render(scene, camera);
      try {
        const canvas = renderer.domElement;
        const frame = document.querySelector(
          '[data-snapshot-frame]',
        ) as HTMLElement | null;
        if (!frame) {
          return canvas.toDataURL('image/png');
        }
        const fr = frame.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        if (fr.width < 2 || fr.height < 2 || cr.width < 2 || cr.height < 2) {
          return canvas.toDataURL('image/png');
        }
        // Intersect frame with canvas (frame is full-width; may extend past top/bottom).
        const left = Math.max(fr.left, cr.left);
        const top = Math.max(fr.top, cr.top);
        const right = Math.min(fr.right, cr.right);
        const bottom = Math.min(fr.bottom, cr.bottom);
        const cssW = right - left;
        const cssH = bottom - top;
        if (cssW < 2 || cssH < 2) {
          return canvas.toDataURL('image/png');
        }
        const scaleX = canvas.width / cr.width;
        const scaleY = canvas.height / cr.height;
        const sx = (left - cr.left) * scaleX;
        const sy = (top - cr.top) * scaleY;
        const sw = cssW * scaleX;
        const sh = cssH * scaleY;
        const out = document.createElement('canvas');
        out.width = Math.round(sw);
        out.height = Math.round(sh);
        const ctx = out.getContext('2d');
        if (!ctx) return canvas.toDataURL('image/png');
        ctx.drawImage(
          canvas,
          Math.round(sx),
          Math.round(sy),
          Math.round(sw),
          Math.round(sh),
          0,
          0,
          out.width,
          out.height,
        );
        return out.toDataURL('image/png');
      } catch {
        return null;
      }
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      viewportController.unregister();
      viewportController.unregisterCapture();
      viewportController.unregisterPose();
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDownCapture, true);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onWindowUp);
      renderer.domElement.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
      transform.detach();
      transform.dispose();
      scene.remove(transform.getHelper());
      transformRef.current = undefined;
      if (moveBallRef.current) {
        scene.remove(moveBallRef.current);
        moveBallRef.current.geometry.dispose();
        (moveBallRef.current.material as THREE.Material).dispose();
        moveBallRef.current = undefined;
      }
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    const transform = transformRef.current;
    if (!group || !grid) return;

    // Detach before disposing meshes so TransformControls never holds a dead object.
    transform?.detach();

    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material)?.dispose();
      });
    }

    // Meshy GLB takes over the viewport massing.
    if (meshyModelUrl) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const selectedSet = new Set(
      selectedIds.length ? selectedIds : selectedId ? [selectedId] : [],
    );
    const meshes = buildMassing(grid, layers, faceQuality ?? 'auto');
    const shadowsOn = viewport.ambientLight;

    for (const { layer, positions } of meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const geomCenter = new THREE.Vector3();
      if (geo.boundingBox) {
        geo.boundingBox.getCenter(geomCenter);
      }

      const mat = makeMaterial(layer, viewport, selectedSet.has(layer.id));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow =
        shadowsOn && layer.kind !== 'ground' && layer.kind !== 'water';
      mesh.receiveShadow = shadowsOn;
      mesh.userData.layerId = layer.id;
      mesh.userData.kind = layer.kind;
      // Offset mesh so pivot origin = geometric center.
      mesh.position.copy(geomCenter).negate();

      const pivot = new THREE.Object3D();
      pivot.userData.layerId = layer.id;
      pivot.userData.kind = layer.kind;
      pivot.userData.geomCenter = geomCenter.clone();
      pivot.userData.isLayerPivot = true;
      applyPivotTransform(pivot, layer, geomCenter);
      pivot.add(mesh);
      group.add(pivot);
    }
  }, [grid, layers, viewport, selectedId, selectedIds, faceQuality, meshyModelUrl]);

  useEffect(() => {
    const meshyGroup = meshyGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!meshyGroup) return;

    while (meshyGroup.children.length) {
      const child = meshyGroup.children[0];
      meshyGroup.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material)?.dispose();
      });
    }

    if (!meshyModelUrl) {
      meshyGroup.visible = false;
      return;
    }

    let cancelled = false;
    const loader = new GLTFLoader();
    const src =
      meshyModelUrl.startsWith('blob:') ||
      meshyModelUrl.startsWith('data:') ||
      meshyModelUrl.startsWith('/')
        ? meshyModelUrl
        : `/api/meshy/asset?url=${encodeURIComponent(meshyModelUrl)}`;

    loader.load(
      src,
      (gltf) => {
        if (cancelled) return;
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // Fit into a unit box then place on the ground plane.
        const box0 = new THREE.Box3().setFromObject(root);
        if (box0.isEmpty()) {
          useAppStore.getState().pushToast('Meshy 模型几何为空', 'error');
          useAppStore.getState().setMeshyModelUrl(null);
          return;
        }
        const size0 = box0.getSize(new THREE.Vector3());
        const maxDim = Math.max(size0.x, size0.y, size0.z, 0.001);
        const scale = 10 / maxDim;
        root.scale.setScalar(scale);
        root.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.x += -center.x;
        root.position.y += -box.min.y;
        root.position.z += -center.z;

        meshyGroup.add(root);
        meshyGroup.visible = true;

        if (camera && controls) {
          const fitted = new THREE.Box3().setFromObject(meshyGroup);
          const fitSize = fitted.getSize(new THREE.Vector3());
          const fitCenter = fitted.getCenter(new THREE.Vector3());
          const dist = Math.max(fitSize.x, fitSize.y, fitSize.z, 1) * 1.8;
          camera.position.set(
            fitCenter.x + dist * 0.75,
            fitCenter.y + dist * 0.55,
            fitCenter.z + dist * 0.9,
          );
          controls.target.copy(fitCenter);
          controls.update();
          useAppStore.getState().attachCameraPoseToSourceSnapshot({
            position: [
              camera.position.x,
              camera.position.y,
              camera.position.z,
            ],
            target: [
              controls.target.x,
              controls.target.y,
              controls.target.z,
            ],
          });
        }
        useAppStore.getState().pushToast('Meshy 模型已载入视口', 'success');
      },
      undefined,
      (err) => {
        console.error('[Meshy GLB]', err);
        useAppStore
          .getState()
          .pushToast('Meshy 模型加载失败（已恢复本地分层预览）', 'error');
        useAppStore.getState().setMeshyModelUrl(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [meshyModelUrl]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = viewport.grid;
  }, [viewport.grid]);

  // Attach / detach move (translate) or rotate gizmo when tool or selection changes
  useEffect(() => {
    const transform = transformRef.current;
    const group = groupRef.current;
    const moveBall = moveBallRef.current;
    if (!transform || !group) return;

    const arm = (
      transform as unknown as { __armGizmo?: (on: boolean) => void }
    ).__armGizmo;

    const isMove = editTool === 'move';
    const isRotate = editTool === 'rotate';
    if (!isMove && !isRotate) {
      arm?.(false);
      transform.enabled = false;
      transform.getHelper().visible = false;
      transform.detach();
      if (moveBall) moveBall.visible = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      return;
    }

    const targetId =
      selectedId ??
      (selectedIds.length === 1 ? selectedIds[0] : null);
    if (!targetId) {
      arm?.(false);
      transform.enabled = false;
      transform.getHelper().visible = false;
      transform.detach();
      if (moveBall) moveBall.visible = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      return;
    }

    const pivot = group.children.find(
      (c) => c.userData.layerId === targetId && c.userData.isLayerPivot,
    );
    if (!pivot) {
      arm?.(false);
      transform.detach();
      transform.enabled = false;
      transform.getHelper().visible = false;
      if (moveBall) moveBall.visible = false;
      return;
    }

    transform.attach(pivot);
    if (isMove) {
      transform.setMode('translate');
      transform.setSpace('world');
      transform.showX = true;
      transform.showY = true;
      transform.showZ = true;
    } else {
      transform.setMode('rotate');
      transform.setSpace('local');
    }
    transform.getHelper().visible = true;
    // Armed but not enabled until the pointer hits the gizmo (see onDownCapture).
    arm?.(true);
    transform.enabled = false;
    if (moveBall) moveBall.visible = isMove;
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, [editTool, selectedId, selectedIds, layers]);

  useEffect(() => {
    const on = viewport.ambientLight;
    if (hemiRef.current) {
      hemiRef.current.intensity = on ? 0.85 : 0.08;
    }
    if (fillRef.current) {
      fillRef.current.intensity = on ? 0.3 : 0.05;
    }
    if (keyLightRef.current) {
      keyLightRef.current.castShadow = on;
      keyLightRef.current.intensity = on ? 1.2 : 0.55;
    }
    if (shadowPlaneRef.current) {
      shadowPlaneRef.current.visible = on;
    }
    if (rendererRef.current) {
      rendererRef.current.shadowMap.enabled = on;
      rendererRef.current.shadowMap.needsUpdate = true;
    }
    const group = groupRef.current;
    if (group) {
      group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          const kind = mesh.userData.kind as string | undefined;
          mesh.castShadow = on && kind !== 'ground' && kind !== 'water';
          mesh.receiveShadow = on;
        }
      });
    }
  }, [viewport.ambientLight]);

  const matClass =
    materialTool === 'eyedropper'
      ? ' tool-eyedropper'
      : materialTool === 'bucket'
        ? ' tool-bucket'
        : '';
  const toolClass =
    editTool === 'move'
      ? ' tool-move'
      : editTool === 'scale'
        ? ' tool-scale'
        : editTool === 'rotate'
          ? ' tool-rotate'
          : '';

  return (
    <div
      className={`viewport-gl${matClass}${toolClass}`}
      ref={mountRef}
    />
  );
}
