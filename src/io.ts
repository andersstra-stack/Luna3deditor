import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEditor, type Snapshot } from "./store";
import { hiddenFolderIds } from "./folders";
import { SHAPES, isLight, isNode, type Folder, type SceneFile, type SceneObject } from "./types";
import { objectQuaternion, round } from "./bounds";
import { sceneMeshes } from "./viewport/three-handle";
import { buildPalette } from "./palette";
import { deserializeMesh, hasMesh, registerMesh, serializeUsedMeshes } from "./meshes";

const SCENE_FILTER = { name: "Luna 3D-scene", extensions: ["luna.json", "json"] };

export function serializeScene(): SceneFile {
  const { objects, folders, notes } = useEditor.getState();
  return { format: "luna3d", version: 3, objects, folders, notes, meshes: serializeUsedMeshes(objects) };
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
  return { objects, folders, notes };
}

/** Lagrer scenen. Uten sti spørres brukeren (eller forrige sti brukes). */
export async function saveScene(path?: string, askIfMissing = true): Promise<string | null> {
  let target = path ?? useEditor.getState().filePath;
  if (!target && askIfMissing) target = await save({ filters: [SCENE_FILTER], defaultPath: "scene.luna.json" });
  if (!target) return null;
  await invoke("write_text_file", { path: target, contents: JSON.stringify(serializeScene(), null, 2) });
  useEditor.getState().setFilePath(target);
  return target;
}

export async function saveSceneAs(): Promise<string | null> {
  const target = await save({ filters: [SCENE_FILTER], defaultPath: "scene.luna.json" });
  return target ? saveScene(target) : null;
}

export async function openScene(path?: string): Promise<string | null> {
  let target = path ?? null;
  if (!target) {
    const picked = await open({ filters: [SCENE_FILTER], multiple: false });
    target = typeof picked === "string" ? picked : null;
  }
  if (!target) return null;
  const scene = parseScene(await invoke<string>("read_text_file", { path: target }));
  const state = useEditor.getState();
  state.setScene(scene);
  state.setFilePath(target);
  return target;
}

export interface GlbExport {
  path: string;
  /** Antall markør-noder i fila. */
  nodes: number;
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
  return { path: target, nodes: built.nodes, palette, emission, colors: built.colors, materials: built.materials };
}

/** Bygger GLB-en i minnet (uten å skrive filer) – også brukt til testing. */
export async function buildGlb(base: string) {
  // Rene kopier (uten utvalgsomriss o.l.), med mappene som navngitte grupper.
  const { objects, folders } = useEditor.getState();
  const hidden = hiddenFolderIds(folders);
  const meshById = new Map(sceneMeshes().map((m) => [m.userData.lunaId as string, m]));
  const groups = new Map<string, THREE.Group>();
  const roots: THREE.Object3D[] = [];

  const groupFor = (id: string | null): THREE.Object3D | null => {
    const folder = id ? folders.find((f) => f.id === id) : undefined;
    if (!folder) return null;
    let group = groups.get(folder.id);
    if (!group) {
      group = new THREE.Group();
      group.name = folder.name;
      groups.set(folder.id, group);
      const parent = groupFor(folder.parentId);
      if (parent) parent.add(group);
      else roots.push(group);
    }
    return group;
  };
  const shown = (o: SceneObject) => o.visible && !(o.folderId && hidden.has(o.folderId));

  // Delene som eksporteres (hull og lys er editor-hjelpere; hullene er allerede skåret ut av geometrien).
  const solids = objects.filter((o) => !isNode(o.type) && !isLight(o.type) && !o.hole && shown(o) && meshById.has(o.id));
  const palette = buildPalette(solids);

  // Ett materiale per materialnavn og utseende (metall, ruhet, gjennomsiktighet) – alle bruker samme palett.
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const paletteNames = new Set<string>();
  const materialFor = (o: SceneObject) => {
    const key = `${o.material ?? ""}|${round(o.metalness, 0.01)}|${round(o.roughness, 0.01)}|${round(o.opacity, 0.01)}`;
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

  let count = 0;
  let nodes = 0;
  for (const obj of objects) {
    if (isNode(obj.type)) {
      if (!shown(obj)) continue;
      // Tom node uten skala: markørstørrelsen er bare for editoren. GLTFExporter skriver userData som extras.
      const n = new THREE.Object3D();
      n.name = obj.name;
      n.position.set(...obj.position);
      n.quaternion.copy(objectQuaternion(obj));
      n.userData = { ...obj.props };
      const parent = groupFor(obj.folderId);
      if (parent) parent.add(n);
      else roots.push(n);
      nodes++;
      count++;
    }
  }
  for (const obj of solids) {
    const mesh = meshById.get(obj.id)!;
    // Egen kopi med UV-er som alle peker på delens rute i paletten.
    const geometry = mesh.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    const [u, v] = palette.uvOf(obj);
    const uv = new Float32Array(geometry.getAttribute("position").count * 2);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = u;
      uv[i + 1] = v;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const c = new THREE.Mesh(geometry, materialFor(obj));
    c.name = obj.name;
    c.position.copy(mesh.position);
    c.quaternion.copy(mesh.quaternion);
    c.scale.copy(mesh.scale);
    const parent = groupFor(obj.folderId);
    if (parent) parent.add(c);
    else roots.push(c);
    count++;
  }
  if (!count) throw new Error("Scenen er tom – ingenting å eksportere");

  const result = await new GLTFExporter().parseAsync(roots, { binary: true });
  const pngs = await palette.png();
  return {
    glb: new Uint8Array(result as ArrayBuffer),
    palettePng: pngs.palette,
    emissionPng: pngs.emission,
    nodes,
    colors: palette.colors,
    materials: [...materials.values()].map((m) => m.name),
  };
}
