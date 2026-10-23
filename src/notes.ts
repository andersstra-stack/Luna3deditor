// Kommentar-pinner: hvor de står i verden, og hvordan de festes til objekter.

import * as THREE from "three";
import { objectBox, objectMatrix, round } from "./bounds";
import type { Note, SceneObject, Vec3 } from "./types";

const toVec3 = (v: THREE.Vector3) => v.toArray().map((x) => round(x)) as Vec3;

/** Verdensposisjonen til pinnen – følger objektet den er festet til. */
export function noteWorldPosition(note: Note, objects: SceneObject[]): THREE.Vector3 {
  const obj = note.objectId ? objects.find((o) => o.id === note.objectId) : undefined;
  if (obj && note.local) return new THREE.Vector3(...note.local).applyMatrix4(objectMatrix(obj));
  return new THREE.Vector3(...note.position);
}

/** Feste-data for en pinne satt på `point` (verden), eventuelt på objektet `obj`. */
export function anchorNote(point: THREE.Vector3, obj?: SceneObject): Pick<Note, "position" | "objectId" | "local"> {
  if (!obj) return { position: toVec3(point), objectId: null };
  const local = point.clone().applyMatrix4(objectMatrix(obj).invert());
  return { position: toVec3(point), objectId: obj.id, local: local.toArray() as Vec3 };
}

/** Standardplassering når bare objektet er oppgitt (f.eks. fra Claude): midt på toppen. */
export function topOf(obj: SceneObject): THREE.Vector3 {
  const box = objectBox(obj);
  return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
}

export const isVisibleNote = (note: Note, showResolved: boolean) => showResolved || note.status === "open";
