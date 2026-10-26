import * as THREE from "three";
import type { MeshAsset, SceneObject, SerializedMesh, SerializedTexture, TextureAsset } from "./types";

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
    if (asset.colors) geo.setAttribute("color", new THREE.BufferAttribute(linearColors(asset.colors), 3));
    if (asset.uvs) geo.setAttribute("uv", new THREE.BufferAttribute(asset.uvs, 2));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geometries.set(id, geo);
  }
  return geo;
}

/** sRGB-byte → lineære farger (det three tegner med). */
function linearColors(srgb: Uint8Array): Float32Array {
  const out = new Float32Array(srgb.length);
  const c = new THREE.Color();
  for (let i = 0; i < srgb.length; i += 3) {
    c.setRGB(srgb[i] / 255, srgb[i + 1] / 255, srgb[i + 2] / 255, THREE.SRGBColorSpace);
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
  }
  return out;
}

/** Hex-fargen (#rrggbb) til hvert hjørne i en geometri med lineære hjørnefarger (også etter CSG). */
export function vertexHexes(geo: THREE.BufferGeometry): string[] | null {
  const attr = geo.getAttribute("color");
  if (!attr) return null;
  const c = new THREE.Color();
  const out: string[] = new Array(attr.count);
  for (let i = 0; i < attr.count; i++) out[i] = `#${c.setRGB(attr.getX(i), attr.getY(i), attr.getZ(i)).getHexString()}`;
  return out;
}

/** Har modellen flere farger (farge per hjørne)? */
export const hasVertexColors = (o: Pick<SceneObject, "type" | "meshId">) =>
  o.type === "mesh" && !!o.meshId && !!assets.get(o.meshId)?.colors;

// ---------- Teksturer ----------
// Bildene ligger i et eget register (også utenfor angre-historikken), så alle delene av en modell deler ett bilde.

const textureAssets = new Map<string, TextureAsset>();
const textures = new Map<string, THREE.Texture>();

/** FNV-1a over bytene + lengden – samme bilde gir samme id. */
export function textureIdOf(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return `tex_${(h >>> 0).toString(36)}_${data.length.toString(36)}`;
}

export function registerTexture(asset: TextureAsset) {
  if (!textureAssets.has(asset.id)) textureAssets.set(asset.id, asset);
}

export const hasTexture = (id: string | undefined) => !!id && textureAssets.has(id);

/** three-teksturen til et bilde i registeret. Bildet lastes asynkront; teksturen oppdateres når det er klart. */
export function textureById(id: string): THREE.Texture | null {
  let tex = textures.get(id);
  if (!tex) {
    const asset = textureAssets.get(id);
    if (!asset) return null;
    const img = new Image();
    tex = new THREE.Texture(img);
    tex.name = id;
    tex.colorSpace = THREE.SRGBColorSpace;
    // UV-ene er lagret med v = 0 øverst (som i glTF).
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    // GLTFExporter bruker dette formatet når bildet skrives inn i GLB-en (ellers PNG, som blir mye større).
    tex.userData.mimeType = asset.mime;
    const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mime }));
    const t = tex;
    img.onload = () => {
      t.needsUpdate = true;
      URL.revokeObjectURL(url);
    };
    img.src = url;
    textures.set(id, tex);
  }
  return tex;
}

/** Teksturen et objekt vises med, eller null (vanlige former og modeller uten tekstur). */
export function textureFor(o: Pick<SceneObject, "type" | "meshId">): THREE.Texture | null {
  const id = o.type === "mesh" && o.meshId ? assets.get(o.meshId)?.textureId : undefined;
  return id ? textureById(id) : null;
}

/** Har objektet en importert tekstur? */
export const hasTextureMap = (o: Pick<SceneObject, "type" | "meshId">) =>
  o.type === "mesh" && !!o.meshId && !!assets.get(o.meshId)?.textureId;

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
    ...(a.colors ? { colors: toBase64(a.colors) } : {}),
    ...(a.uvs ? { uvs: toBase64(a.uvs) } : {}),
    ...(a.textureId ? { textureId: a.textureId } : {}),
  };
}

export function deserializeMesh(m: SerializedMesh): MeshAsset {
  return {
    id: m.id,
    name: m.name,
    positions: new Float32Array(fromBase64(m.positions)),
    normals: new Float32Array(fromBase64(m.normals)),
    ...(m.index ? { index: new Uint32Array(fromBase64(m.index)) } : {}),
    ...(m.colors ? { colors: new Uint8Array(fromBase64(m.colors)) } : {}),
    // En modell hvis tekstur mangler (f.eks. limt inn fra en eldre versjon) vises uten tekstur.
    ...(m.uvs && hasTexture(m.textureId) ? { uvs: new Float32Array(fromBase64(m.uvs)), textureId: m.textureId } : {}),
  };
}

export function serializeTexture(t: TextureAsset): SerializedTexture {
  return { id: t.id, mime: t.mime, data: toBase64(t.data) };
}

export function deserializeTexture(t: SerializedTexture): TextureAsset {
  return { id: t.id, mime: t.mime, data: new Uint8Array(fromBase64(t.data)) };
}

/** Modellene som objektene faktisk bruker, klare for lagring. */
export function serializeUsedMeshes(objects: SceneObject[]): SerializedMesh[] {
  const ids = new Set(objects.map((o) => o.meshId).filter((id): id is string => hasMesh(id)));
  return [...ids].map((id) => serializeMesh(assets.get(id)!));
}

/** Teksturene de modellene bruker. Registreres før modellene når de leses inn igjen. */
export function serializeUsedTextures(objects: SceneObject[]): SerializedTexture[] {
  const ids = new Set(objects.map((o) => (o.meshId ? assets.get(o.meshId)?.textureId : undefined)).filter((id): id is string => hasTexture(id)));
  return [...ids].map((id) => serializeTexture(textureAssets.get(id)!));
}
