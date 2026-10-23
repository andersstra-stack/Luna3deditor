import * as THREE from "three";
import type { MeshAsset, SceneObject, SerializedMesh } from "./types";

/**
 * Register over geometrien til importerte modeller. Geometrien endres aldri etter
 * import, så registeret ligger utenfor angre-historikken: et objekt som angres bort
 * og tilbake, peker fortsatt på samme modell. Ubrukte modeller tas ikke med når
 * scenen lagres.
 */
const assets = new Map<string, MeshAsset>();
const geometries = new Map<string, THREE.BufferGeometry>();

export function registerMesh(asset: MeshAsset) {
  assets.set(asset.id, asset);
}

export const hasMesh = (id: string | undefined) => !!id && assets.has(id);
export const getMeshAsset = (id: string) => assets.get(id);

export function meshGeometry(id: string): THREE.BufferGeometry {
  let geo = geometries.get(id);
  if (!geo) {
    const asset = assets.get(id);
    if (!asset) throw new Error(`Fant ikke modelldata ${id}`);
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(asset.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(asset.normals, 3));
    if (asset.index) geo.setIndex(new THREE.BufferAttribute(asset.index, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geometries.set(id, geo);
  }
  return geo;
}

// ---------- Lagring (base64) ----------

function toBase64(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = "";
  // I biter, så String.fromCharCode ikke får for mange argumenter.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function serializeMesh(a: MeshAsset): SerializedMesh {
  return {
    id: a.id,
    name: a.name,
    positions: toBase64(a.positions),
    normals: toBase64(a.normals),
    ...(a.index ? { index: toBase64(a.index) } : {}),
  };
}

export function deserializeMesh(m: SerializedMesh): MeshAsset {
  return {
    id: m.id,
    name: m.name,
    positions: new Float32Array(fromBase64(m.positions)),
    normals: new Float32Array(fromBase64(m.normals)),
    ...(m.index ? { index: new Uint32Array(fromBase64(m.index)) } : {}),
  };
}

/** Modellene som objektene faktisk bruker, klare for lagring. */
export function serializeUsedMeshes(objects: SceneObject[]): SerializedMesh[] {
  const ids = new Set(objects.map((o) => o.meshId).filter((id): id is string => hasMesh(id)));
  return [...ids].map((id) => serializeMesh(assets.get(id)!));
}
