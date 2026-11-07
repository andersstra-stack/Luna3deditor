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
    // Hudvekter (bundet til skjelett): brukes av SkinnedMesh i visningen og blir JOINTS_0/WEIGHTS_0 i eksporten.
    if (asset.joints && asset.weights) {
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(asset.joints, 4));
      geo.setAttribute("skinWeight", new THREE.BufferAttribute(asset.weights, 4));
    }
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

/** Bredde og høyde i piksler, lest fra hodet i PNG- eller JPEG-fila (uten å pakke ut bildet, så det kan brukes synkront). */
export function imageSizeOf(id: string): { width: number; height: number } | null {
  const data = textureAssets.get(id)?.data;
  if (!data) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === 0x89 && data[1] === 0x50 && data.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = data[i + 1];
      // SOF0–SOF15 har målene; C4 (Huffman), C8 og CC er andre segmenter med tall i samme område.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }
      // Fyllbyte eller segment uten lengde.
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  return null;
}

/** three-teksturen til et bilde i registeret. Bildet lastes asynkront; teksturen oppdateres når det er klart. */
export const textureById = (id: string) => loadTexture(id, THREE.SRGBColorSpace);

/** Normalkart er data, ikke farger: samme bilde må ikke tolkes som sRGB, så de har hver sin three-tekstur. */
function loadTexture(id: string, colorSpace: THREE.ColorSpace): THREE.Texture | null {
  const cacheKey = `${colorSpace}:${id}`;
  let tex = textures.get(cacheKey);
  if (!tex) {
    const asset = textureAssets.get(id);
    if (!asset) return null;
    const img = new Image();
    tex = new THREE.Texture(img);
    tex.name = id;
    tex.colorSpace = colorSpace;
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
    textures.set(cacheKey, tex);
  }
  return tex;
}

/** Teksturen et objekt vises med, eller null (vanlige former og modeller uten tekstur). */
export function textureFor(o: Pick<SceneObject, "type" | "meshId">): THREE.Texture | null {
  const id = o.type === "mesh" && o.meshId ? assets.get(o.meshId)?.textureId : undefined;
  return id ? textureById(id) : null;
}

/** Normalkartet et objekt vises med, eller null. */
export function normalMapFor(o: Pick<SceneObject, "type" | "meshId">): THREE.Texture | null {
  const id = o.type === "mesh" && o.meshId ? assets.get(o.meshId)?.normalTextureId : undefined;
  return id ? loadTexture(id, THREE.NoColorSpace) : null;
}

/** Ruhetskartet et objekt vises med, eller null. Data, ikke farger (som normalkart); ruheten leses fra grønnkanalen. */
export function roughnessMapFor(o: Pick<SceneObject, "type" | "meshId">): THREE.Texture | null {
  const id = o.type === "mesh" && o.meshId ? assets.get(o.meshId)?.roughnessTextureId : undefined;
  return id ? loadTexture(id, THREE.NoColorSpace) : null;
}

/** Hvor sterkt normalkartet til objektet virker. */
export const normalScaleOf = (o: Pick<SceneObject, "meshId">) => (o.meshId ? assets.get(o.meshId)?.normalScale : undefined) ?? 1;

/** Bruker objektet bilder med egne UV-er (tekstur eller normalkart)? Da kan det ikke slås sammen eller deles opp. */
export const hasTextureMap = (o: Pick<SceneObject, "type" | "meshId">) => {
  const asset = o.type === "mesh" && o.meshId ? assets.get(o.meshId) : undefined;
  return !!asset?.textureId || !!asset?.normalTextureId || !!asset?.roughnessTextureId;
};

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
    ...(a.normalTextureId ? { normalTextureId: a.normalTextureId, normalScale: a.normalScale } : {}),
    ...(a.roughnessTextureId ? { roughnessTextureId: a.roughnessTextureId } : {}),
    ...(a.joints && a.weights ? { joints: toBase64(a.joints), weights: toBase64(a.weights) } : {}),
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
    ...(m.uvs && (hasTexture(m.textureId) || hasTexture(m.normalTextureId) || hasTexture(m.roughnessTextureId))
      ? { uvs: new Float32Array(fromBase64(m.uvs)) }
      : {}),
    ...(m.uvs && hasTexture(m.textureId) ? { textureId: m.textureId } : {}),
    ...(m.uvs && hasTexture(m.normalTextureId) ? { normalTextureId: m.normalTextureId, normalScale: m.normalScale } : {}),
    ...(m.uvs && hasTexture(m.roughnessTextureId) ? { roughnessTextureId: m.roughnessTextureId } : {}),
    ...(m.joints && m.weights ? { joints: new Uint16Array(fromBase64(m.joints)), weights: new Float32Array(fromBase64(m.weights)) } : {}),
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
  const ids = new Set(
    objects
      .flatMap((o) => {
        const asset = o.meshId ? assets.get(o.meshId) : undefined;
        return [asset?.textureId, asset?.normalTextureId, asset?.roughnessTextureId, o.imageId];
      })
      .filter((id): id is string => hasTexture(id)),
  );
  return [...ids].map((id) => serializeTexture(textureAssets.get(id)!));
}
