// «Forenkle» (som Decimate i Blender): færre trekanter på en modell, med UV, hjørnefarger og bildene i behold.
// Matten ligger i simplifyCore.ts (meshoptimizer); her blir resultatet en ny modell i registeret, og objektet
// beholder id-en sin (pinner, animasjoner og skriptmerket følger med). Brukes av store.simplifyObjects.

import * as THREE from "three";
import { getMeshAsset, registerMesh } from "./meshes";
import { objectQuaternion, round } from "./bounds";
import { simplifyGeometry, triangleCount, type SimplifyTarget } from "./simplifyCore";
import type { SceneObject, Vec3 } from "./types";

export { simplifierReady, type SimplifyTarget } from "./simplifyCore";

export interface SimplifiedObject {
  id: string;
  name: string;
  before: number;
  after: number;
  /** Største avvik fra den opprinnelige formen, omtrent, i millimeter. */
  error_mm: number;
}

export interface SimplifyResult {
  simplified: SimplifiedObject[];
  skipped: { id: string; name: string; reason: string }[];
}

let counter = 0;

/** Trekantene i en modell (0 for andre former). */
export function trianglesOf(o: Pick<SceneObject, "type" | "meshId">): number {
  const asset = o.type === "mesh" && o.meshId ? getMeshAsset(o.meshId) : undefined;
  return asset ? triangleCount(asset) : 0;
}

/**
 * Forenkler modellen til objektet og gir endringene (ny meshId, posisjon og størrelse – formen er normalisert til
 * enhetsboksen igjen), eller grunnen til at den ble hoppet over. Like modeller i samme kall deles via `cache`.
 */
export function simplifiedObject(
  obj: SceneObject,
  target: SimplifyTarget,
  cache = new Map<string, ReturnType<typeof simplifyGeometry> & { meshId: string }>(),
): { update: Pick<SceneObject, "meshId" | "position" | "scale">; info: SimplifiedObject } | { skip: string } {
  const asset = obj.type === "mesh" && obj.meshId ? getMeshAsset(obj.meshId) : undefined;
  if (!asset) return { skip: "ikke en modell (type mesh)" };
  const before = triangleCount(asset);
  let g = cache.get(asset.id);
  if (!g) {
    const result = simplifyGeometry(asset, obj.scale, target);
    if (result.after >= before) return { skip: `har allerede ${before} trekanter` };
    const meshId = `mesh_s${Date.now().toString(36)}_${(counter++).toString(36)}`;
    registerMesh({
      id: meshId,
      name: asset.name,
      positions: result.positions,
      normals: result.normals,
      ...(result.index ? { index: result.index } : {}),
      ...(result.colors ? { colors: result.colors } : {}),
      ...(result.uvs ? { uvs: result.uvs } : {}),
      ...(asset.textureId ? { textureId: asset.textureId } : {}),
      ...(asset.normalTextureId ? { normalTextureId: asset.normalTextureId, normalScale: asset.normalScale } : {}),
      ...(asset.roughnessTextureId ? { roughnessTextureId: asset.roughnessTextureId } : {}),
    });
    g = { ...result, meshId };
    cache.set(asset.id, g);
  }
  // Den nye formens midtpunkt i verdensrommet: posisjon + rotasjon·(størrelse ⊙ lokalt midtpunkt), som i meshSplit.
  const offset = new THREE.Vector3(g.center[0] * obj.scale[0], g.center[1] * obj.scale[1], g.center[2] * obj.scale[2]).applyQuaternion(
    objectQuaternion(obj),
  );
  const extent = Math.max(...obj.scale.map(Math.abs));
  return {
    update: {
      meshId: g.meshId,
      position: obj.position.map((p, i) => round(p + offset.getComponent(i), 1e-5)) as Vec3,
      scale: obj.scale.map((v, i) => round(v * g.size[i], 1e-5)) as Vec3,
    },
    info: { id: obj.id, name: obj.name, before, after: g.after, error_mm: round(g.error * extent * 1000, 0.01) },
  };
}
