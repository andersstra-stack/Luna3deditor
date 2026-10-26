import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { hasUnsavedChanges, useEditor, type Snapshot } from "./store";
import { hiddenFolderIds } from "./folders";
import { SHAPES, isLight, isNode, type Folder, type SceneFile, type SceneObject } from "./types";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boxOf, objectMatrix, objectQuaternion, round } from "./bounds";
import { sceneMeshes } from "./viewport/three-handle";
import { buildPalette } from "./palette";
import { deserializeMesh, hasMesh, registerMesh, serializeUsedMeshes, vertexHexes } from "./meshes";
import { isPivotNode, makeAnimator } from "./animation";

type Animator = ReturnType<typeof makeAnimator>;
/** Bilder per sekund når animasjonene samples til glTF-spor. */
const ANIMATION_FPS = 30;

const SCENE_FILTER = { name: "Luna 3D-scene", extensions: ["luna.json", "json"] };

export function serializeScene(): SceneFile {
  const { objects, folders, notes, clips } = useEditor.getState();
  return { format: "luna3d", version: 3, objects, folders, notes, ...(clips.length ? { clips } : {}), meshes: serializeUsedMeshes(objects) };
}

function parseScene(text: string): Snapshot {
  const data = JSON.parse(text) as Partial<SceneFile> & { version?: number };
  if (data.format !== "luna3d" || !Array.isArray(data.objects)) throw new Error("Ikke en Luna 3D-scenefil");
  for (const o of data.objects) {
    if (!SHAPES.includes(o.type)) throw new Error(`Ukjent objekttype: ${o.type}`);
  }
  // Versjon 1 hadde ikke mapper, versjon 2 ikke importerte modeller.
  for (const m of data.meshes ?? []) registerMesh(deserializeMesh(m));
  const folders: Folder[] = Array.isArray(data.folders) ? data.folders : [];
  const folderIds = new Set(folders.map((f) => f.id));
  const objects = data.objects
    .filter((o) => o.type !== "mesh" || hasMesh(o.meshId))
    .map((o) => ({ ...o, folderId: o.folderId && folderIds.has(o.folderId) ? o.folderId : null }));
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const clips = Array.isArray(data.clips) ? data.clips : [];
  return { objects, folders, notes, clips };
}

/** Lagrer scenen. Uten sti spørres brukeren (eller forrige sti brukes). */
export async function saveScene(path?: string, askIfMissing = true): Promise<string | null> {
  let target = path ?? useEditor.getState().filePath;
  if (!target && askIfMissing) target = await save({ filters: [SCENE_FILTER], defaultPath: "scene.luna.json" });
  if (!target) return null;
  await invoke("write_text_file", { path: target, contents: JSON.stringify(serializeScene(), null, 2) });
  useEditor.getState().setFilePath(target);
  useEditor.getState().markSaved();
  return target;
}

export async function saveSceneAs(): Promise<string | null> {
  const target = await save({ filters: [SCENE_FILTER], defaultPath: "scene.luna.json" });
  return target ? saveScene(target) : null;
}

/**
 * Spør om ulagrede endringer før de kastes (ny scene, åpne, lukke). `true` = gå videre: ingenting å miste, scenen ble
 * lagret, eller brukeren valgte å ikke lagre.
 */
export async function confirmDiscard(): Promise<boolean> {
  const state = useEditor.getState();
  if (!hasUnsavedChanges(state)) return true;
  const name = state.filePath?.split(/[\\/]/).pop() ?? "den ulagrede scenen";
  const choice = await message(`Vil du lagre endringene i ${name}?`, {
    title: "Ulagrede endringer",
    kind: "warning",
    buttons: { yes: "Lagre", no: "Ikke lagre", cancel: "Avbryt" },
  });
  if (choice === "Lagre" || choice === "Yes") return (await saveScene()) !== null;
  return choice === "Ikke lagre" || choice === "No";
}

/** Ny, tom scene (spør først om ulagrede endringer). */
export async function newScene(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const state = useEditor.getState();
  state.clearScene();
  state.setFilePath(null);
  state.markSaved();
}

/** Åpner en scene. Uten sti (brukeren) spørres det først om ulagrede endringer; med sti (MCP) åpnes den direkte. */
export async function openScene(path?: string): Promise<string | null> {
  let target = path ?? null;
  if (!target) {
    if (!(await confirmDiscard())) return null;
    const picked = await open({ filters: [SCENE_FILTER], multiple: false });
    target = typeof picked === "string" ? picked : null;
  }
  if (!target) return null;
  const scene = parseScene(await invoke<string>("read_text_file", { path: target }));
  const state = useEditor.getState();
  state.setScene(scene);
  state.setFilePath(target);
  state.markSaved();
  return target;
}

export interface GlbExport {
  path: string;
  /** Antall markør-noder i fila. */
  nodes: number;
  /** Mapper som ble eksportert som én modell. */
  models: number;
  /** Animasjonsklippene i fila (navn og antall spor). */
  animations: { name: string; channels: number }[];
  /** Ting i animasjonene som ikke kunne eksporteres, og hvorfor. */
  warnings: string[];
  /** Palett-PNG ved siden av GLB-en (bildet ligger også inne i GLB-en), og glød-bildet hvis noe gløder. */
  palette: string;
  emission?: string;
  colors: number;
  materials: string[];
}

const fileBase = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.glb$/i, "");

/**
 * Eksporterer synlige objekter som GLB (kan åpnes i Blender, Roblox Studio, Unity, osv).
 * Som i Nova-biblioteket deler delene felles palett-materialer: fargene ligger i en palett-PNG (én piksel per
 * farge), og hver del har UV-er som peker på sin piksel. Glød blir `<navn>_emission.png`. Objekter med eget
 * materialnavn (f.eks. «nova_glass») får et eget materiale med det navnet.
 * Markør-noder blir tomme noder med egenskapene som `extras` – eneste kilde; Unity-siden leser dem selv fra GLB-fila.
 */
export async function exportGlb(path?: string): Promise<GlbExport | null> {
  let target = path ?? null;
  if (!target) target = await save({ filters: [{ name: "glTF binær", extensions: ["glb"] }], defaultPath: "scene.glb" });
  if (!target) return null;
  const built = await buildGlb(fileBase(target));
  await invoke("write_binary_file", { path: target, contents: Array.from(built.glb) });
  const dir = target.replace(/[\\/][^\\/]*$/, "");
  const sep = target.includes("\\") ? "\\" : "/";
  const palette = `${dir}${sep}${fileBase(target)}_palette.png`;
  await invoke("write_binary_file", { path: palette, contents: Array.from(built.palettePng) });
  let emission: string | undefined;
  if (built.emissionPng) {
    emission = `${dir}${sep}${fileBase(target)}_emission.png`;
    await invoke("write_binary_file", { path: emission, contents: Array.from(built.emissionPng) });
  }
  return {
    path: target,
    nodes: built.nodes,
    models: built.models,
    animations: built.animations,
    warnings: built.warnings,
    palette,
    emission,
    colors: built.colors,
    materials: built.materials,
  };
}

/** Bygger GLB-en i minnet (uten å skrive filer) – også brukt til testing. */
export async function buildGlb(base: string) {
  // Rene kopier (uten utvalgsomriss o.l.), med mappene som navngitte grupper.
  const { objects, folders } = useEditor.getState();
  const hidden = hiddenFolderIds(folders);
  const meshById = new Map(sceneMeshes().map((m) => [m.userData.lunaId as string, m]));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const shown = (o: SceneObject) => o.visible && !(o.folderId && hidden.has(o.folderId));

  // Delene som eksporteres (hull og lys er editor-hjelpere; hullene er allerede skåret ut av geometrien).
  const solids = objects.filter((o) => !isNode(o.type) && !isLight(o.type) && !o.hole && shown(o) && meshById.has(o.id));
  // Farge per hjørne for sammenslåtte modeller med flere farger, ellers delens egen farge.
  const hexes = new Map(solids.map((o) => [o.id, vertexHexes(meshById.get(o.id)!.geometry)]));
  const palette = buildPalette(
    solids.flatMap((o) => [...new Set(hexes.get(o.id) ?? [o.color])].map((color) => ({ color, emissive: o.emissive }))),
  );

  // Ett materiale per materialnavn og utseende (metall, ruhet, gjennomsiktighet) – alle bruker samme palett.
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const paletteNames = new Set<string>();
  const materialKey = (o: SceneObject) =>
    `${o.material ?? ""}|${round(o.metalness, 0.01)}|${round(o.roughness, 0.01)}|${round(o.opacity, 0.01)}`;
  const materialFor = (o: SceneObject) => {
    const key = materialKey(o);
    let m = materials.get(key);
    if (!m) {
      let name = o.material ?? `${base}_palette`;
      if (!o.material) {
        for (let i = 2; paletteNames.has(name); i++) name = `${base}_palette_${i}`;
        paletteNames.add(name);
      }
      m = new THREE.MeshStandardMaterial({
        name,
        map: palette.map,
        metalness: o.metalness,
        roughness: o.roughness,
        transparent: o.opacity < 1,
        opacity: o.opacity,
      });
      materials.set(key, m);
    }
    if ((o.emissive ?? 0) > 0 && palette.emissive && !m.emissiveMap) {
      m.emissive = new THREE.Color(1, 1, 1);
      m.emissiveMap = palette.emissive;
    }
    return m;
  };

  /** Delens geometri med UV-er som peker på fargens rute i paletten (posisjon, normal og uv – ikke hjørnefarger). */
  const paletteGeometry = (o: SceneObject) => {
    const geometry = meshById.get(o.id)!.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    const perVertex = hexes.get(o.id);
    const uv = new Float32Array(geometry.getAttribute("position").count * 2);
    for (let i = 0; i < uv.length / 2; i++) uv.set(palette.uvOf(perVertex ? perVertex[i] : o.color, o.emissive), i * 2);
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return geometry;
  };

  // ---------- Mapper merket «Én modell» ----------
  // Et objekt hører til nærmeste mappe oppover som er en modell. Undermapper som ikke selv er modeller slås inn i den.
  const modelOf = (folderId: string | null): Folder | null => {
    for (let f = folderId ? folderById.get(folderId) : undefined; f; f = f.parentId ? folderById.get(f.parentId) : undefined) {
      if (f.model) return f;
    }
    return null;
  };
  const isPivot = (o: SceneObject) => isPivotNode(o) && !!modelOf(o.folderId);
  const worldOf = (o: SceneObject) =>
    new THREE.Matrix4().compose(new THREE.Vector3(...o.position), objectQuaternion(o), new THREE.Vector3(1, 1, 1));

  /** Modellens origo: en node som heter «pivot» (hengsel, hjulaksel …), ellers midt under delene. */
  const modelFrames = new Map<string, THREE.Matrix4>();
  const modelFrame = (model: Folder) => {
    let frame = modelFrames.get(model.id);
    if (!frame) {
      const pivot = objects.find((o) => isPivot(o) && modelOf(o.folderId) === model);
      if (pivot) frame = worldOf(pivot);
      else {
        const box = boxOf(solids.filter((o) => modelOf(o.folderId) === model));
        const c = box.isEmpty()
          ? new THREE.Vector3()
          : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
        frame = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z);
      }
      modelFrames.set(model.id, frame);
    }
    return frame;
  };

  /** Delene i en modell bakt inn i modellens rom, én gruppe per materiale (blir delmesher/primitives i GLB-en). */
  const modelMesh = (model: Folder): THREE.Object3D => {
    const parts = solids.filter((o) => modelOf(o.folderId) === model);
    const toModel = modelFrame(model).clone().invert();
    const byMaterial = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const o of parts) {
      const indexed = paletteGeometry(o);
      const geo = indexed.index ? indexed.toNonIndexed() : indexed;
      const m = toModel.clone().multiply(objectMatrix(o));
      geo.applyMatrix4(m);
      // Speilet del (negativ størrelse): snu trekantene, ellers vender flatene innover.
      if (m.determinant() < 0) {
        for (const attr of Object.values(geo.attributes) as THREE.BufferAttribute[]) {
          for (let t = 0; t < attr.count; t += 3) {
            for (let k = 0; k < attr.itemSize; k++) {
              const a = attr.getComponent(t + 1, k);
              attr.setComponent(t + 1, k, attr.getComponent(t + 2, k));
              attr.setComponent(t + 2, k, a);
            }
          }
        }
      }
      const key = materialKey(o);
      let group = byMaterial.get(key);
      if (!group) byMaterial.set(key, (group = { material: materialFor(o), geos: [] }));
      group.geos.push(geo);
    }
    const groups = [...byMaterial.values()];
    const node = parts.length
      ? new THREE.Mesh(
          mergeGeometries(
            groups.map((g) => mergeVertices(mergeGeometries(g.geos)!)),
            true,
          )!,
          groups.map((g) => g.material),
        )
      : new THREE.Object3D();
    node.name = model.name;
    return node;
  };

  // ---------- Hierarkiet ----------
  // Hver eksportert node: målet den tilsvarer, og verdensmatrisen ved tid t i et klipp (for animasjonene).
  const worldFns = new Map<THREE.Object3D, { target: string; world: (a: Animator, t: number) => THREE.Matrix4 }>();
  const nodesByFolder = new Map<string, THREE.Object3D>();
  const roots: THREE.Object3D[] = [];
  let models = 0;

  /** Noden en mappe tilsvarer: en gruppe, eller modellen den hører til. */
  const nodeFor = (folderId: string | null): THREE.Object3D | null => {
    const folder = folderId ? folderById.get(folderId) : undefined;
    if (!folder) return null;
    const model = modelOf(folder.id);
    if (model && model !== folder) return nodeFor(model.id);
    let node = nodesByFolder.get(folder.id);
    if (!node) {
      const parent = nodeFor(folder.parentId);
      if (model) {
        node = modelMesh(model);
        // Plassering i forhold til det modellen henger under: en ytre modell, eller verden (mappegrupper står i origo).
        const outer = modelOf(folder.parentId);
        const local = (outer ? modelFrame(outer).clone().invert() : new THREE.Matrix4()).multiply(modelFrame(model));
        local.decompose(node.position, node.quaternion, node.scale);
        models++;
      } else {
        node = new THREE.Group();
        node.name = folder.name;
      }
      nodesByFolder.set(folder.id, node);
      worldFns.set(node, {
        target: folder.id,
        world: (a, t) => (model ? a.folderMotion(folder.id, t).multiply(modelFrame(model)) : a.folderMotion(folder.id, t)),
      });
      if (parent) parent.add(node);
      else roots.push(node);
    }
    return node;
  };

  /** Plasserer et objekt (verdensmatrise) under mappa si – i modellens rom hvis mappa hører til en modell. */
  const attach = (child: THREE.Object3D, world: THREE.Matrix4, folderId: string | null, target: string) => {
    const rest = world.clone();
    worldFns.set(child, { target, world: (a, t) => a.folderMotion(folderId, t).multiply(a.motion(target, t)).multiply(rest) });
    const model = modelOf(folderId);
    const local = model ? modelFrame(model).clone().invert().multiply(world) : world;
    local.decompose(child.position, child.quaternion, child.scale);
    const parent = nodeFor(folderId);
    if (parent) parent.add(child);
    else roots.push(child);
  };

  let count = 0;
  let nodes = 0;
  for (const obj of objects) {
    // Pivot-noden er modellens origo, ikke en egen node.
    if (!isNode(obj.type) || !shown(obj) || isPivot(obj)) continue;
    // Tom node uten skala: markørstørrelsen er bare for editoren. GLTFExporter skriver userData som extras.
    const n = new THREE.Object3D();
    n.name = obj.name;
    n.userData = { ...obj.props };
    attach(n, worldOf(obj), obj.folderId, obj.id);
    nodes++;
    count++;
  }
  for (const obj of solids) {
    count++;
    // Deler i en modell slås inn i den (nodeFor bygger modellen første gang).
    if (modelOf(obj.folderId)) {
      nodeFor(obj.folderId);
      continue;
    }
    const c = new THREE.Mesh(paletteGeometry(obj), materialFor(obj));
    c.name = obj.name;
    attach(c, objectMatrix(obj), obj.folderId, obj.id);
  }
  if (!count) throw new Error("Scenen er tom – ingenting å eksportere");

  // ---------- Animasjoner ----------
  // Alt under én scene, så hvert spor finner noden sin (sporene peker på nodenes uuid – navn kan gå igjen).
  const scene = new THREE.Scene();
  for (const r of roots) scene.add(r);
  const { clips } = useEditor.getState();
  const warnings: string[] = [];
  const animations: THREE.AnimationClip[] = [];
  for (const clip of clips) {
    const animator = makeAnimator(clip, objects, folders);
    // Deler som er bakt inn i en ytre modell kan ikke bevege seg for seg selv.
    for (const track of clip.tracks) {
      const obj = objects.find((o) => o.id === track.target);
      const owner = obj ? modelOf(obj.folderId) : modelOf(track.target);
      const baked = obj ? !isNode(obj.type) && !!owner : !!owner && owner.id !== track.target;
      if (baked) {
        warnings.push(
          `«${obj?.name ?? folderById.get(track.target)?.name}» i «${clip.name}» er bakt inn i modellen «${owner!.name}» – gi den en egen mappe med «Én modell» for å animere den.`,
        );
      }
    }
    const steps = Math.max(1, Math.ceil(clip.duration * ANIMATION_FPS));
    const times = Array.from({ length: steps + 1 }, (_, i) => Math.min(clip.duration, i / ANIMATION_FPS));
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [node, info] of worldFns) {
      if (!animator.animates(info.target)) continue;
      const parent = node.parent ? worldFns.get(node.parent) : undefined;
      const p: number[] = [];
      const q: number[] = [];
      const s: number[] = [];
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      let prev: THREE.Quaternion | null = null;
      for (const t of times) {
        const local = (parent ? parent.world(animator, t).invert() : new THREE.Matrix4()).multiply(info.world(animator, t));
        local.decompose(pos, quat, scl);
        // Samme vei rundt som forrige bilde (q og -q er samme rotasjon), ellers spinner interpoleringen feil vei.
        if (prev && prev.dot(quat) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
        prev = quat.clone();
        p.push(pos.x, pos.y, pos.z);
        q.push(quat.x, quat.y, quat.z, quat.w);
        s.push(scl.x, scl.y, scl.z);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, p));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, q));
      if (s.some((v, i) => Math.abs(v - s[i % 3]) > 1e-5)) tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.scale`, times, s));
    }
    if (tracks.length) animations.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }

  const result = await new GLTFExporter().parseAsync(scene, { binary: true, animations });
  const pngs = await palette.png();
  return {
    glb: new Uint8Array(result as ArrayBuffer),
    palettePng: pngs.palette,
    emissionPng: pngs.emission,
    nodes,
    models,
    animations: animations.map((a) => ({ name: a.name, channels: a.tracks.length })),
    warnings,
    colors: palette.colors,
    materials: [...materials.values()].map((m) => m.name),
  };
}
