// «Del opp i løse deler» (som Blender: P → By Loose Parts): en importert modell deles i bitene som
// ikke henger sammen. Hjørner på samme sted regnes som felles – importerte mesher har ofte ikke
// indeks, og fargeoppdelingen gir hver trekant egne hjørner.

import * as THREE from "three";
import { newId, useEditor, type NewObject } from "./store";
import { getMeshAsset, registerMesh } from "./meshes";
import { objectQuaternion, round } from "./bounds";
import type { MeshAsset, SceneObject, Vec3 } from "./types";

/** Flere biter enn dette blir uhåndterlig i scenelista – da lar vi modellen være. */
export const MAX_PIECES = 500;

/** Trekantene i hver sammenhengende bit (største bit først). */
function looseParts(asset: MeshAsset): number[][] {
  const pos = asset.positions;
  const corner = (t: number, k: number) => (asset.index ? asset.index[t * 3 + k] : t * 3 + k);
  const triangles = (asset.index ? asset.index.length : pos.length / 3) / 3;

  // Samme sted (innenfor 1e-5 av modellens størrelse – den er normalisert til enhetsboksen) = samme hjørne.
  const vertexIds = new Map<string, number>();
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const vertex = (v: number) => {
    const key = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = parent.length;
      parent.push(id);
      vertexIds.set(key, id);
    }
    return id;
  };

  const first: number[] = new Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [vertex(corner(t, 0)), vertex(corner(t, 1)), vertex(corner(t, 2))];
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
    first[t] = a;
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    const root = find(first[t]);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(t);
  }
  return [...groups.values()].sort((x, y) => y.length - x.length);
}

/** Én bit som eget objekt: geometrien normaliseres til enhetsboksen igjen, og plassering/størrelse regnes om. */
function pieceObject(obj: SceneObject, asset: MeshAsset, tris: number[], n: number): NewObject {
  const corner = (t: number, k: number) => (asset.index ? asset.index[t * 3 + k] : t * 3 + k);
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = corner(t, k);
      positions.set(asset.positions.subarray(v * 3, v * 3 + 3), i * 9 + k * 3);
      normals.set(asset.normals.subarray(v * 3, v * 3 + 3), i * 9 + k * 3);
    }
  });

  const box = new THREE.Box3().setFromArray(positions);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // En helt flat akse beholder størrelse 1 (som ved import), ellers blir matrisen ikke inverterbar.
  const s = [size.x, size.y, size.z].map((v) => (v > 1e-5 ? v : 1));
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) positions[i + a] = (positions[i + a] - c.getComponent(a)) / s[a];
  }

  const meshId = newId("mesh");
  const name = `${obj.name}.${n}`;
  registerMesh({ id: meshId, name, positions, normals });

  // Bitens midtpunkt i verdensrommet: objektets posisjon + rotasjon·(størrelse ⊙ lokalt midtpunkt).
  const offset = new THREE.Vector3(c.x * obj.scale[0], c.y * obj.scale[1], c.z * obj.scale[2]).applyQuaternion(objectQuaternion(obj));
  const { id: _id, script: _script, ...rest } = obj;
  return {
    ...rest,
    type: "mesh",
    meshId,
    name,
    position: obj.position.map((p, i) => round(p + offset.getComponent(i))) as Vec3,
    scale: obj.scale.map((v, i) => round(v * s[i], 1e-4)) as Vec3,
  };
}

export interface SplitResult {
  /** Objektene som ble delt, med antall biter. */
  split: { name: string; pieces: number }[];
  /** Id-ene til de nye bitene. */
  created: string[];
  /** Objekter som ikke ble delt, og hvorfor. */
  skipped: { name: string; reason: string }[];
}

/** Deler de valgte importerte modellene i løse deler – alt som ett angre-steg. */
export function splitLooseParts(ids: string[]): SplitResult {
  const state = useEditor.getState();
  const result: SplitResult = { split: [], created: [], skipped: [] };
  const remove: string[] = [];
  const items: NewObject[] = [];

  for (const id of ids) {
    const obj = state.objects.find((o) => o.id === id);
    if (!obj) throw new Error(`Fant ikke objekt ${id}`);
    const asset = obj.type === "mesh" && obj.meshId ? getMeshAsset(obj.meshId) : undefined;
    if (!asset) {
      result.skipped.push({ name: obj.name, reason: "ikke en importert modell" });
      continue;
    }
    const parts = looseParts(asset);
    if (parts.length < 2) {
      result.skipped.push({ name: obj.name, reason: "henger sammen i én bit" });
      continue;
    }
    if (parts.length > MAX_PIECES) {
      result.skipped.push({ name: obj.name, reason: `${parts.length} biter – mer enn ${MAX_PIECES}` });
      continue;
    }
    remove.push(obj.id);
    parts.forEach((tris, i) => items.push(pieceObject(obj, asset, tris, i + 1)));
    result.split.push({ name: obj.name, pieces: parts.length });
  }

  if (items.length) result.created = state.replaceObjects(remove, items).map((o) => o.id);
  const total = result.split.reduce((n, s) => n + s.pieces, 0);
  state.setActivity(
    result.split.length
      ? `Delte ${result.split.length === 1 ? result.split[0].name : `${result.split.length} modeller`} i ${total} deler`
      : `Ingenting å dele${result.skipped.length ? `: ${result.skipped.map((s) => `${s.name} ${s.reason}`).join(", ")}` : ""}`,
  );
  return result;
}
