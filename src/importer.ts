import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { newId, useEditor } from "./store";
import { registerMesh } from "./meshes";
import { round } from "./bounds";
import { fbxUserProps } from "./fbxProps";
import { DEFAULT_COLORS, type NodeProps, type Vec3 } from "./types";
import { viewTargetOnGround } from "./viewport/three-handle";
import { useUi } from "./ui/uiStore";

export const IMPORT_EXTENSIONS = ["fbx", "glb", "gltf", "obj", "stl"];

/** Over så mange deler slås deler med samme farge sammen, så scenelista holder seg brukbar. */
const MAX_PARTS = 150;
/** Maks antall farger én mesh deles opp i (resten får nærmeste av disse). */
const MAX_COLORS_PER_MESH = 24;

/** Leser en fil modellen refererer til (tekstur, .mtl) – null hvis den ikke finnes. */
export type ResourceResolver = (fileName: string) => Promise<ArrayBuffer | null>;

/** En tom node (Empty i Blender) fra modellfila – blir en Luna-node. */
interface ImportedNode {
  name: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  props: NodeProps;
}

interface Part {
  name: string;
  /** Materialnavnet i fila (f.eks. «nova_glass») – blir med i eksporten. */
  materialName?: string;
  geometry: THREE.BufferGeometry;
  color: string;
  opacity: number;
  metalness: number;
  roughness: number;
}

export interface ImportOptions {
  folderId?: string | null;
  /** Med keepOrigin: der filas origo havner. Ellers: midten av fotavtrykket, med bunnen i høyde y. */
  position?: Vec3;
  /** Behold filas origo (standard: innstillingen i appen). Deler med samme origo passer da sammen. */
  keepOrigin?: boolean;
}

export interface ImportResult {
  objectIds: string[];
  folderId: string | null;
  parts: number;
  /** Tomme noder (Empties) fra fila som ble markør-noder. */
  nodes: number;
  /** Om filas origo ble beholdt (i stedet for å sentrere modellen). */
  keptOrigin: boolean;
  /** Faktor modellen ble skalert med for å komme til meter (1 = uendret). */
  unitScale: number;
  size: Vec3;
  /** Teksturfiler som ble funnet og brukt til farger. */
  textures: string[];
}

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const baseName = (name: string) => name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
/** Filnavnet (uten mappe), med små bokstaver – slik refererte filer slås opp. */
const fileKey = (url: string) => decodeURIComponent(url.split(/[\\/]/).pop() ?? "").toLowerCase();

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", gif: "image/gif" };
const noResources: ResourceResolver = async () => null;

async function parseModel(name: string, data: ArrayBuffer, manager: THREE.LoadingManager, resolve: ResourceResolver): Promise<THREE.Object3D> {
  switch (extensionOf(name)) {
    case "fbx":
      return new FBXLoader(manager).parse(data, "");
    case "glb":
    case "gltf":
      // .gltf med eksterne .bin-/teksturfiler støttes ikke – bruk .glb eller innebygd .gltf.
      return (await new GLTFLoader(manager).parseAsync(data, "")).scene;
    case "obj": {
      const text = new TextDecoder().decode(data);
      const loader = new OBJLoader(manager);
      // Farger og teksturer ligger i en .mtl-fil ved siden av.
      const lib = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
      const mtl = lib ? await resolve(lib) : null;
      if (mtl) {
        const materials = new MTLLoader(manager).parse(new TextDecoder().decode(mtl), "");
        materials.preload();
        loader.setMaterials(materials);
      }
      return loader.parse(text);
    }
    case "stl":
      // STL (3D-utskrift) har Z opp – snu til Luna sin Y opp.
      return new THREE.Mesh(new STLLoader().parse(data).rotateX(-Math.PI / 2));
    default:
      throw new Error(`Ukjent filtype: ${name}. Støttet: ${IMPORT_EXTENSIONS.join(", ")}`);
  }
}

/**
 * Laster modellen med teksturer fra samme mappe. FBX/OBJ refererer til bildefiler ved navn;
 * først finner vi ut hvilke filer den ber om, så leses de og modellen lastes på nytt med dem.
 * (Innebygde teksturer – blob:/data: – brukes som de er.)
 */
async function loadModel(fileName: string, data: ArrayBuffer, resolve: ResourceResolver) {
  const ext = extensionOf(fileName);
  const passThrough = (url: string) => url.startsWith("blob:") || url.startsWith("data:");
  if (ext !== "fbx" && ext !== "obj") return { root: await parseModel(fileName, data, new THREE.LoadingManager(), resolve), textures: [] };

  const wanted = new Set<string>();
  const probe = new THREE.LoadingManager();
  probe.setURLModifier((url) => {
    if (passThrough(url)) return url;
    wanted.add(fileKey(url));
    return TRANSPARENT_PNG;
  });
  const first = await parseModel(fileName, data, probe, resolve);

  const urls = new Map<string, string>();
  for (const key of wanted) {
    const buf = await resolve(key);
    if (buf) urls.set(key, URL.createObjectURL(new Blob([buf], { type: MIME[extensionOf(key)] ?? "application/octet-stream" })));
  }
  if (!urls.size) return { root: first, textures: [] };

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (passThrough(url) ? url : (urls.get(fileKey(url)) ?? TRANSPARENT_PNG)));
  let started = false;
  manager.onStart = () => (started = true);
  const loaded = new Promise<void>((res) => {
    manager.onLoad = () => res();
    setTimeout(res, 8000);
  });
  const root = await parseModel(fileName, data, manager, resolve);
  if (started) await loaded;
  for (const url of urls.values()) URL.revokeObjectURL(url);
  return { root, textures: [...urls.keys()] };
}

// ---------- Farger per flate ----------

const pixelCache = new WeakMap<object, ImageData | null>();
function pixels(texture: THREE.Texture): ImageData | null {
  const img = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width || !img.height) return null;
  if (!pixelCache.has(img)) {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    pixelCache.set(img, ctx.getImageData(0, 0, img.width, img.height));
  }
  return pixelCache.get(img)!;
}

/**
 * Fargen til hver trekant: fra teksturen (fargepalett-bilder i lowpoly-modeller),
 * hjørnefarger, eller materialet (også flere materialer på samme mesh).
 * Null hvis hele meshen bare har materialets ene farge.
 */
function triangleColors(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): string[] | null {
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
  const index = geometry.index;
  const uv = geometry.getAttribute("uv");
  const vertexColor = geometry.getAttribute("color");
  const triangles = Math.floor((index ? index.count : geometry.getAttribute("position").count) / 3);
  const corner = (i: number) => (index ? index.getX(i) : i);
  for (const m of materials) m?.map?.updateMatrix();

  let varies = materials.length > 1;
  const out: string[] = new Array(triangles);
  const uvSum = new THREE.Vector2();
  const color = new THREE.Color();
  for (let t = 0; t < triangles; t++) {
    const start = t * 3;
    const group = geometry.groups.find((g) => start >= g.start && start < g.start + g.count);
    const m = materials[group?.materialIndex ?? 0] ?? materials[0];
    const img = m?.map ? pixels(m.map) : null;

    if (img && uv) {
      uvSum.set(0, 0);
      for (let k = 0; k < 3; k++) uvSum.add(new THREE.Vector2(uv.getX(corner(start + k)), uv.getY(corner(start + k))));
      uvSum.divideScalar(3);
      m.map!.transformUv(uvSum); // offset/repeat, wrapping og flipY
      const x = THREE.MathUtils.clamp(Math.floor(uvSum.x * img.width), 0, img.width - 1);
      const y = THREE.MathUtils.clamp(Math.floor(uvSum.y * img.height), 0, img.height - 1);
      const p = (y * img.width + x) * 4;
      color.setRGB(img.data[p] / 255, img.data[p + 1] / 255, img.data[p + 2] / 255, THREE.SRGBColorSpace);
      varies = true;
    } else if (vertexColor && m?.vertexColors) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 3; k++) {
        const v = corner(start + k);
        r += vertexColor.getX(v) / 3;
        g += vertexColor.getY(v) / 3;
        b += vertexColor.getZ(v) / 3;
      }
      color.setRGB(r, g, b); // hjørnefarger er lineære, som arbeidsfargerommet
      varies = true;
    } else {
      color.copy(m?.color ?? new THREE.Color(0xcccccc));
    }
    out[t] = `#${color.getHexString()}`;
  }
  return varies ? out : null;
}

const rgbDistance = (a: string, b: string) => {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return (ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2;
};

/** Deler en geometri opp i én bit per farge (største først). */
function splitByColor(geometry: THREE.BufferGeometry, colors: string[]): { color: string; geometry: THREE.BufferGeometry }[] {
  const byColor = new Map<string, number[]>();
  colors.forEach((c, t) => byColor.set(c, [...(byColor.get(c) ?? []), t]));

  // For mange farger (f.eks. et fotografisk bilde): behold de vanligste og flytt resten til nærmeste.
  let groups = [...byColor.entries()].sort((a, b) => b[1].length - a[1].length);
  if (groups.length > MAX_COLORS_PER_MESH) {
    const keep = groups.slice(0, MAX_COLORS_PER_MESH);
    for (const [c, tris] of groups.slice(MAX_COLORS_PER_MESH)) {
      const nearest = keep.reduce((best, g) => (rgbDistance(c, g[0]) < rgbDistance(c, best[0]) ? g : best));
      nearest[1].push(...tris);
    }
    groups = keep;
  }

  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const index = geometry.index;
  return groups.map(([color, tris]) => {
    const p = new Float32Array(tris.length * 9);
    const n = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const v = index ? index.getX(t * 3 + k) : t * 3 + k;
        const o = i * 9 + k * 3;
        p.set([pos.getX(v), pos.getY(v), pos.getZ(v)], o);
        n.set([nor.getX(v), nor.getY(v), nor.getZ(v)], o);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    return { color, geometry: g };
  });
}

/** Plukker ut alle mesher i verdensrom, delt opp etter farge. */
function extractParts(root: THREE.Object3D, fallbackName: string): Part[] {
  root.updateMatrixWorld(true);
  const parts: Part[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute("position")) return;
    const colors = triangleColors(mesh, mesh.geometry);

    const geometry = mesh.geometry.clone();
    for (const attr of Object.keys(geometry.attributes)) if (attr !== "position" && attr !== "normal") geometry.deleteAttribute(attr);
    geometry.morphAttributes = {};
    geometry.clearGroups();
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    geometry.applyMatrix4(mesh.matrixWorld);

    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    const look = {
      materialName: material?.name || undefined,
      opacity: material?.transparent ? (material.opacity ?? 1) : 1,
      metalness: material?.metalness ?? 0,
      roughness: material?.roughness ?? 0.6,
    };
    const name = mesh.name || fallbackName;

    if (colors) {
      const pieces = splitByColor(geometry, colors);
      pieces.forEach((piece, i) =>
        parts.push({ ...look, name: pieces.length === 1 ? name : `${name} ${i + 1}`, geometry: piece.geometry, color: piece.color }),
      );
      return;
    }
    // Filer uten materiale (STL, OBJ uten .mtl) får innlasterens hvite standard – bruk heller en palettfarge.
    const hasRealColor = material?.color && (material.name || material.color.getHex() !== 0xffffff);
    parts.push({
      ...look,
      name,
      geometry,
      color: hasRealColor ? `#${material!.color.getHexString()}` : DEFAULT_COLORS[parts.length % DEFAULT_COLORS.length],
    });
  });
  return parts;
}

/** Flate egenskaper (tall eller tekst) fra glTF-extras; sannhetsverdier blir 1/0, resten hoppes over. */
function flatProps(extras: Record<string, unknown>): NodeProps {
  const props: NodeProps = {};
  for (const [k, v] of Object.entries(extras ?? {})) {
    if (typeof v === "number" || typeof v === "string") props[k] = v;
    else if (typeof v === "boolean") props[k] = v ? 1 : 0;
  }
  return props;
}

/**
 * Tomme noder i verdensrom. FBX: alle modeller som ikke er mesh/lys/kamera/bein (Empties i Blender),
 * med Custom Properties lest rett fra fila. glTF: noder uten mesh som er blader eller har extras –
 * en tom node med barn og uten extras er bare en gruppe (slik Luna eksporterer mapper).
 */
function extractNodes(root: THREE.Object3D, ext: string, data: ArrayBuffer): ImportedNode[] {
  // FBX fra Blender: nodens «forover» (Blender +Y) ligger langs lokal −Z i fila. Snu noden om sin egen
  // Y-akse så lokal +Z blir forover, som ellers i Luna (og i Unity etter import).
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  if (ext !== "fbx" && ext !== "glb" && ext !== "gltf") return [];
  const fbx = ext === "fbx" ? fbxUserProps(data) : null;
  root.updateMatrixWorld(true);
  const nodes: ImportedNode[] = [];
  const s = new THREE.Vector3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Light).isLight || (o as THREE.Camera).isCamera || (o as THREE.Bone).isBone) return;
    if ((o as THREE.Object3D & { isLineSegments?: boolean }).isLineSegments || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) return;
    let name: string;
    let props: NodeProps;
    if (fbx) {
      const id = (o as THREE.Object3D & { ID?: number }).ID;
      if (id === undefined) return; // gruppa FBXLoader lager rundt alt
      name = (o.userData.originalName as string | undefined) || o.name;
      props = fbx.byId.get(id) ?? fbx.byName.get(name) ?? {};
    } else {
      if (o === root) return;
      props = flatProps(o.userData);
      if (o.children.length && !Object.keys(props).length) return;
      name = o.name;
    }
    if (!name) return;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    o.matrixWorld.decompose(position, quaternion, s);
    if (fbx) quaternion.multiply(flip);
    nodes.push({ name, position, quaternion, props });
  });
  return nodes;
}

/** Slår sammen deler med samme utseende (for modeller med veldig mange deler). */
function mergeByAppearance(parts: Part[]): Part[] {
  const groups = new Map<string, Part[]>();
  for (const p of parts) {
    const key = `${p.color}|${p.opacity}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].map((group, i) => ({
    ...group[0],
    name: groups.size === 1 ? group[0].name : `Del ${i + 1}`,
    geometry: mergeGeometries(group.map((p) => (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry)))!,
  }));
}

/**
 * Enheten, siden Luna bruker meter: glTF er alltid i meter, og FBX sier selv hvor mange cm én
 * enhet er (`UnitScaleFactor`; Blender skriver 100 for meter). Ellers gjettes det: STL er nesten
 * alltid i millimeter, OBJ ofte i centimeter, og veldig store modeller skaleres ned.
 */
function unitScaleFor(ext: string, size: THREE.Vector3, root: THREE.Object3D): number {
  const largest = Math.max(size.x, size.y, size.z);
  if (ext === "glb" || ext === "gltf") return 1;
  const fbxUnit = Number(root.userData.unitScaleFactor);
  if (ext === "fbx" && fbxUnit > 0) return fbxUnit / 100;
  if (ext === "stl") return largest > 10 ? 0.001 : 1;
  if (largest > 5000) return 0.001;
  if (largest > 50) return 0.01;
  return 1;
}

/** Importerer modelldata (fra fil eller dra-og-slipp) inn i scenen. */
export async function importModelData(
  fileName: string,
  data: ArrayBuffer,
  opts: ImportOptions = {},
  resolve: ResourceResolver = noResources,
): Promise<ImportResult> {
  const name = baseName(fileName);
  const ext = extensionOf(fileName);
  const { root, textures } = await loadModel(fileName, data, resolve);
  // FBX snus 180° om Y. Unity leser FBX som Blender (x, y, z) → Unity (x, z, y), mens glTF-importøren
  // (glTFast) speiler X. Snudd slik havner en GLB eksportert fra Luna på samme sted i Unity som FBX-en.
  const scene = ext === "fbx" ? new THREE.Group().add(root) : root;
  if (ext === "fbx") scene.rotation.y = Math.PI;
  let parts = extractParts(scene, name);
  const nodes = extractNodes(scene, ext, data);
  if (!parts.length && !nodes.length) throw new Error(`Fant ingen 3D-former i ${fileName}`);
  if (parts.length > MAX_PARTS) parts = mergeByAppearance(parts);

  const total = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    total.union(p.geometry.boundingBox!);
  }
  for (const n of nodes) total.expandByPoint(n.position);
  const unitScale = unitScaleFor(ext, total.getSize(new THREE.Vector3()), root);
  if (unitScale !== 1) {
    for (const p of parts) p.geometry.scale(unitScale, unitScale, unitScale);
    for (const n of nodes) n.position.multiplyScalar(unitScale);
    total.min.multiplyScalar(unitScale);
    total.max.multiplyScalar(unitScale);
  }

  // Plassering: filas origo i scenens origo (eller på oppgitt posisjon) – eller, uten det valget,
  // bunnen på bakken og midten der kameraet ser.
  const keepOrigin = opts.keepOrigin ?? useUi.getState().importKeepOrigin;
  const center = total.getCenter(new THREE.Vector3());
  const [tx, tz] = opts.position ? [opts.position[0], opts.position[2]] : viewTargetOnGround();
  const offset = keepOrigin
    ? new THREE.Vector3(...(opts.position ?? [0, 0, 0]))
    : new THREE.Vector3(tx - center.x, (opts.position?.[1] ?? 0) - total.min.y, tz - center.z);

  const state = useEditor.getState();
  let folderId = opts.folderId !== undefined ? opts.folderId : state.activeFolderId;
  if (parts.length + nodes.length > 1) folderId = state.addFolders([{ name, parentId: folderId }])[0].id;

  const items = parts.map((p) => {
    // Normaliser til enhetsboksen (som alle andre former), så scale = størrelse i meter.
    // En helt flat akse (f.eks. et plan) beholder størrelse 1, ellers blir matrisen ikke inverterbar.
    p.geometry.computeBoundingBox();
    const b = p.geometry.boundingBox!;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const s = [size.x, size.y, size.z].map((v) => (v > 1e-5 ? v : 1)) as Vec3;
    p.geometry.translate(-c.x, -c.y, -c.z).scale(1 / s[0], 1 / s[1], 1 / s[2]);

    const meshId = newId("mesh");
    const g = p.geometry;
    registerMesh({
      id: meshId,
      name: p.name,
      positions: new Float32Array(g.getAttribute("position").array),
      normals: new Float32Array(g.getAttribute("normal").array),
      ...(g.index ? { index: new Uint32Array(g.index.array) } : {}),
    });
    return {
      type: "mesh" as const,
      meshId,
      name: p.name,
      position: [c.x + offset.x, c.y + offset.y, c.z + offset.z].map((v) => round(v)) as Vec3,
      scale: s.map((v) => round(v, 1e-4)) as Vec3,
      color: p.color,
      opacity: p.opacity,
      metalness: p.metalness,
      roughness: p.roughness,
      ...(p.materialName ? { material: p.materialName } : {}),
      folderId,
    };
  });

  // Nodene: lokal +Z er forover og +Y opp, som i FBX/glTF – rotasjonen kan tas rett over.
  const nodeItems = nodes.map((n) => {
    const e = new THREE.Euler().setFromQuaternion(n.quaternion, "XYZ");
    return {
      type: "node" as const,
      name: n.name,
      position: n.position.clone().add(offset).toArray().map((v) => round(v)) as Vec3,
      rotation: [e.x, e.y, e.z].map((v) => round(THREE.MathUtils.radToDeg(v), 0.01)) as Vec3,
      ...(Object.keys(n.props).length ? { props: n.props } : {}),
      folderId,
    };
  });

  const created = state.addObjects([...items, ...nodeItems]);
  state.selectMany(created.map((o) => o.id));
  const size = total.getSize(new THREE.Vector3());
  const result: ImportResult = {
    objectIds: created.map((o) => o.id),
    folderId: parts.length + nodes.length > 1 ? folderId : null,
    parts: parts.length,
    nodes: nodes.length,
    keptOrigin: keepOrigin,
    unitScale,
    size: [size.x, size.y, size.z].map((v) => round(v)) as Vec3,
    textures,
  };
  const notes = [
    nodes.length ? `${nodes.length} noder` : "",
    keepOrigin ? "filas origo beholdt" : "",
    unitScale === 1 ? "" : `skalert ×${unitScale} til meter`,
    textures.length ? `farger fra ${textures.join(", ")}` : "",
  ];
  const note = notes.filter(Boolean).join(", ");
  state.setActivity(`Importerte ${name}: ${parts.length} del${parts.length === 1 ? "" : "er"}${note ? ` (${note})` : ""}`);
  return result;
}

/** Importerer en fil fra disk. Uten sti åpnes en fildialog. Teksturer/.mtl leses fra samme mappe. */
export async function importModelFile(path?: string, opts?: ImportOptions) {
  let target = path ?? null;
  if (!target) {
    const picked = await open({ filters: [{ name: "3D-modell", extensions: IMPORT_EXTENSIONS }], multiple: false });
    target = typeof picked === "string" ? picked : null;
  }
  if (!target) return null;
  const data = await invoke<ArrayBuffer>("read_binary_file", { path: target });
  const dir = target.replace(/[\\/][^\\/]*$/, "");
  const sep = target.includes("\\") ? "\\" : "/";
  const siblings: ResourceResolver = (file) =>
    invoke<ArrayBuffer>("read_binary_file", { path: `${dir}${sep}${file.split(/[\\/]/).pop()}` }).catch(() => null);
  return importModelData(target, data, opts, siblings);
}

/** Dra-og-slipp: modellfiler importeres, og bilder/.mtl som slippes sammen med dem brukes som ressurser. */
export async function importDroppedFiles(files: File[]): Promise<{ imported: string[]; skipped: string[] }> {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const resolve: ResourceResolver = async (name) => (await byName.get(fileKey(name))?.arrayBuffer()) ?? null;
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (IMPORT_EXTENSIONS.includes(extensionOf(file.name))) {
      await importModelData(file.name, await file.arrayBuffer(), {}, resolve);
      imported.push(file.name);
    } else if (!MIME[extensionOf(file.name)] && extensionOf(file.name) !== "mtl") {
      skipped.push(file.name);
    }
  }
  return { imported, skipped };
}
