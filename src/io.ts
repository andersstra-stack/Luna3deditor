import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEditor, type Snapshot } from "./store";
import { hiddenFolderIds } from "./folders";
import { SHAPES, isLight, isNode, type Folder, type SceneFile } from "./types";
import { objectQuaternion } from "./bounds";
import { sceneMeshes } from "./viewport/three-handle";
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
}

/**
 * Eksporterer synlige objekter som GLB (kan åpnes i Blender, Roblox Studio, Unity, osv).
 * Markør-noder blir tomme noder med egenskapene som `extras` – eneste kilde; Unity-siden leser dem selv fra GLB-fila.
 */
export async function exportGlb(path?: string): Promise<GlbExport | null> {
  let target = path ?? null;
  if (!target) target = await save({ filters: [{ name: "glTF binær", extensions: ["glb"] }], defaultPath: "scene.glb" });
  if (!target) return null;

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

  let count = 0;
  let nodes = 0;
  for (const obj of objects) {
    if (isNode(obj.type)) {
      if (!obj.visible || (obj.folderId && hidden.has(obj.folderId))) continue;
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
      continue;
    }
    const mesh = meshById.get(obj.id);
    // Hull og lys er editor-hjelpere; hullene er allerede skåret ut av geometrien (CSG).
    if (!mesh || !obj.visible || obj.hole || isLight(obj.type) || (obj.folderId && hidden.has(obj.folderId))) continue;
    const c = new THREE.Mesh(mesh.geometry, mesh.material);
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
  const bytes = new Uint8Array(result as ArrayBuffer);
  await invoke("write_binary_file", { path: target, contents: Array.from(bytes) });
  return { path: target, nodes };
}
