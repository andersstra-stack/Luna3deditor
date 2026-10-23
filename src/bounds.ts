import * as THREE from "three";
import type { SceneObject } from "./types";
import { geometryOf } from "./viewport/geometries";

const DEG = Math.PI / 180;

export function objectQuaternion(o: Pick<SceneObject, "rotation">): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, "XYZ"));
}

/** Verdensmatrisen til et objekt, beregnet fra dataene (ikke fra 3D-visningen). */
export function objectMatrix(o: Pick<SceneObject, "position" | "rotation" | "scale">): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...o.position), objectQuaternion(o), new THREE.Vector3(...o.scale));
}

// Objektene er uforanderlige, så boksen kan caches per objekt-referanse.
const boxCache = new WeakMap<SceneObject, THREE.Box3>();
const v = new THREE.Vector3();

/** Nøyaktig omsluttende boks i verdensrommet (også for roterte former). */
export function objectBox(o: SceneObject): THREE.Box3 {
  let box = boxCache.get(o);
  if (!box) {
    box = new THREE.Box3();
    const m = objectMatrix(o);
    const pos = geometryOf(o).getAttribute("position");
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    boxCache.set(o, box);
  }
  return box.clone();
}

export function boxOf(objects: SceneObject[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const o of objects) box.union(objectBox(o));
  return box;
}

export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];
export const axisIndex = (a: Axis) => AXES.indexOf(a);

/** Avrunder for å unngå støy som 0.30000000000000004 i dataene. */
export const round = (value: number, step = 0.001) => Math.round(value / step) * step;
