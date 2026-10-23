// Markør-noder: usynlige punkter med navn, retning og egenskaper som spillmotoren leser fra modellen
// (dock_entry, hp_turret_S_01, spawn_pirate_bridge_01 …). Lokal +Z er «forover», +Y er «opp».

import * as THREE from "three";
import { objectQuaternion, round } from "./bounds";
import { isNode, type SceneObject, type Vec3 } from "./types";

/**
 * Et ledig nodenavn. Spillet slår opp på navn, så kopier får neste nummer i stedet for « 2»:
 * hp_turret_S_01 → hp_turret_S_02, dock → dock_02.
 */
export function uniqueNodeName(base: string, taken: { name: string }[]): string {
  const names = new Set(taken.map((o) => o.name));
  if (!names.has(base)) return base;
  const m = /^(.*?)(\d+)$/.exec(base);
  const stem = m ? m[1] : `${base}_`;
  const width = m ? m[2].length : 2;
  let i = m ? Number(m[2]) + 1 : 2;
  while (names.has(`${stem}${String(i).padStart(width, "0")}`)) i++;
  return `${stem}${String(i).padStart(width, "0")}`;
}

/** Hva som er galt med et nodenavn (eller null). Unity finner nodene på navn, så de må være entydige. */
export function nodeNameProblem(node: SceneObject, objects: SceneObject[]): string | null {
  if (/\s/.test(node.name)) return "Navnet har mellomrom – spillet finner noder på navn, bruk _ i stedet";
  if (/\.\d{3}$/.test(node.name)) return "Navnet slutter på .001 o.l. – fjern nummeret";
  if (objects.some((o) => o.id !== node.id && isNode(o.type) && o.name === node.name)) return "En annen node har samme navn";
  return null;
}

const dir = (o: SceneObject, v: THREE.Vector3) =>
  v.applyQuaternion(objectQuaternion(o)).toArray().map((c) => round(c)) as Vec3;

/** Nodens retninger i verdensrommet: forover (lokal +Z) og opp (lokal +Y). */
export function nodeAxes(o: SceneObject): { forward: Vec3; up: Vec3 } {
  return { forward: dir(o, new THREE.Vector3(0, 0, 1)), up: dir(o, new THREE.Vector3(0, 1, 0)) };
}
