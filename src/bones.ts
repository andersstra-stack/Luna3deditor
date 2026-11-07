// Bein i et skjelett (type "bone"): roten er `position`, lokal +Y peker mot tuppen, `scale[1]` er lengden og
// `scale[0]`/`scale[2]` bare tykkelsen på markøren. Forelder i `parentId`. Se også skinning.ts (vekter) og animation.ts.

import * as THREE from "three";
import { objectQuaternion, round } from "./bounds";
import { isBone, type SceneObject, type Vec3 } from "./types";

const DEG = Math.PI / 180;

/** Tykkelsen på beinmarkøren i forhold til lengden. */
export const BONE_WIDTH = 0.12;

/** Plassering, rotasjon og størrelse for et bein fra rot til tupp (verdensrom). `roll` dreier det om sin egen akse (grader). */
export function boneFromHeadTail(head: Vec3, tail: Vec3, roll = 0, width?: number): Pick<SceneObject, "position" | "rotation" | "scale"> {
  for (const [name, v] of [
    ["head", head],
    ["tail", tail],
  ] as const) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`${name} må være tre tall [x, y, z]`);
    }
  }
  const dir = new THREE.Vector3(...tail).sub(new THREE.Vector3(...head));
  const length = dir.length();
  if (length < 1e-4) throw new Error("Et bein må ha lengde: head og tail kan ikke være samme punkt");
  // Korteste dreining fra +Y: et bein langs X (en arm i T-positur) beholder Z som forover.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll * DEG));
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const w = width ?? length * BONE_WIDTH;
  return {
    position: head.map((v) => round(v, 1e-4)) as Vec3,
    rotation: [e.x, e.y, e.z].map((v) => round(v / DEG, 0.01)) as Vec3,
    scale: [round(w, 1e-4), round(length, 1e-4), round(w, 1e-4)],
  };
}

/** Tuppen av beinet i verdensrommet. */
export function boneTail(o: Pick<SceneObject, "position" | "rotation" | "scale">): Vec3 {
  return new THREE.Vector3(0, o.scale[1], 0)
    .applyQuaternion(objectQuaternion(o))
    .add(new THREE.Vector3(...o.position))
    .toArray()
    .map((v) => round(v, 1e-4)) as Vec3;
}

/** Beinets hvile i verdensrommet uten størrelse: leddet og aksene (det skjelettet og eksporten bruker). */
export function boneRest(o: Pick<SceneObject, "position" | "rotation">): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...o.position), objectQuaternion(o), new THREE.Vector3(1, 1, 1));
}

/** Forelderbeinet, hvis det finnes. */
export function parentBone(o: SceneObject, byId: Map<string, SceneObject>): SceneObject | undefined {
  const p = o.parentId ? byId.get(o.parentId) : undefined;
  return p && isBone(p.type) && p.id !== o.id ? p : undefined;
}

/** Alle bein under `ids` (barn, barnebarn …), ikke `ids` selv. */
export function descendantBones(objects: SceneObject[], ids: string[]): string[] {
  const children = new Map<string, string[]>();
  for (const o of objects) {
    if (isBone(o.type) && o.parentId) children.set(o.parentId, [...(children.get(o.parentId) ?? []), o.id]);
  }
  const out: string[] = [];
  const seen = new Set(ids);
  const stack = [...ids];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}

/** Ville `parent` som forelder til `bone` gi en ring (beinet blir sin egen forfar)? */
export function makesCycle(objects: SceneObject[], bone: string, parent: string): boolean {
  return parent === bone || descendantBones(objects, [bone]).includes(parent);
}

/** Bein sortert slik at foreldre kommer før barna (for eksport og skjelett). */
export function bonesInOrder(bones: SceneObject[]): SceneObject[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  const out: SceneObject[] = [];
  const done = new Set<string>();
  const visit = (b: SceneObject, depth = 0) => {
    if (done.has(b.id) || depth > bones.length) return;
    const p = parentBone(b, byId);
    if (p) visit(p, depth + 1);
    if (!done.has(b.id)) {
      done.add(b.id);
      out.push(b);
    }
  };
  bones.forEach((b) => visit(b));
  return out;
}

/** L ↔ R i beinnavn (arm_L → arm_R, hand.l → hand.r, venstre ↔ høyre) – for speilkopier. */
export function mirrorBoneName(name: string): string {
  const swaps: [RegExp, string][] = [
    [/([._ -])L$/, "$1R"],
    [/([._ -])R$/, "$1L"],
    [/([._ -])l$/, "$1r"],
    [/([._ -])r$/, "$1l"],
    [/Left/, "Right"],
    [/Right/, "Left"],
    [/left/, "right"],
    [/right/, "left"],
    [/venstre/, "høyre"],
    [/høyre/, "venstre"],
  ];
  for (const [re, to] of swaps) if (re.test(name)) return name.replace(re, to);
  return name;
}
