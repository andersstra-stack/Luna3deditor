import * as THREE from "three";
import type { RootState } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useEditor } from "../store";

/**
 * Gir kode utenfor <Canvas> (MCP-broen, eksport) tilgang til three.js-tilstanden.
 */
let getState: (() => RootState) | null = null;

export function setThreeGetter(get: () => RootState) {
  getState = get;
}

export function three(): RootState {
  if (!getState) throw new Error("3D-visningen er ikke klar ennå");
  return getState();
}

export const VIEWS = ["current", "front", "back", "left", "right", "top", "iso"] as const;
export type ViewName = (typeof VIEWS)[number];

const VIEW_DIRS: Record<Exclude<ViewName, "current">, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.15, 1),
  back: new THREE.Vector3(0, 0.15, -1),
  left: new THREE.Vector3(-1, 0.15, 0),
  right: new THREE.Vector3(1, 0.15, 0),
  top: new THREE.Vector3(0, 1, 0.001),
  iso: new THREE.Vector3(1, 0.8, 1),
};

/** Alle scene-objekter (ikke hjelpere som rutenett og gizmo). */
export function sceneMeshes(): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  three().scene.traverse((o) => {
    if (o.userData.lunaId && (o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

/** Plasserer kameraet slik at hele scenen synes fra gitt retning. */
export function frameScene(view: ViewName = "iso") {
  const { camera, controls } = three();
  const orbit = controls as unknown as OrbitControlsImpl | null;
  const box = new THREE.Box3();
  for (const m of sceneMeshes()) if (m.visible) box.expandByObject(m);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));

  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const fov = ((camera as THREE.PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
  const distance = (radius / Math.sin(fov / 2)) * 1.05;

  const dir =
    view === "current"
      ? camera.position.clone().sub(orbit?.target ?? center).normalize()
      : VIEW_DIRS[view].clone().normalize();

  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  if (orbit) {
    orbit.target.copy(center);
    orbit.update();
  } else {
    camera.lookAt(center);
  }
}

/** Punktet på bakken kameraet ser mot, avrundet til rutenettet. */
export function viewTargetOnGround(): [number, number] {
  try {
    const orbit = three().controls as unknown as OrbitControlsImpl | null;
    const t = orbit?.target ?? new THREE.Vector3();
    return [Math.round(t.x * 2) / 2, Math.round(t.z * 2) / 2];
  } catch {
    return [0, 0];
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Tar et bilde av 3D-visningen (uten utvalgs-gizmo) og returnerer base64-PNG. */
export async function captureViewport(maxWidth = 1024): Promise<{ base64: string; width: number; height: number }> {
  const { selectedId, select } = useEditor.getState();
  select(null);
  await nextFrame();
  await nextFrame();
  try {
    const src = three().gl.domElement;
    const scale = Math.min(1, maxWidth / src.width);
    const out = document.createElement("canvas");
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
    const base64 = out.toDataURL("image/png").split(",")[1];
    return { base64, width: out.width, height: out.height };
  } finally {
    select(selectedId);
  }
}
