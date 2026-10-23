import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEditor } from "./store";
import { SHAPES, type SceneFile, type SceneObject } from "./types";
import { sceneMeshes } from "./viewport/three-handle";

const SCENE_FILTER = { name: "Luna 3D-scene", extensions: ["luna.json", "json"] };

export function serializeScene(): SceneFile {
  return { format: "luna3d", version: 1, objects: useEditor.getState().objects };
}

function parseScene(text: string): SceneObject[] {
  const data = JSON.parse(text) as Partial<SceneFile>;
  if (data.format !== "luna3d" || !Array.isArray(data.objects)) throw new Error("Ikke en Luna 3D-scenefil");
  for (const o of data.objects) {
    if (!SHAPES.includes(o.type)) throw new Error(`Ukjent objekttype: ${o.type}`);
  }
  return data.objects;
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
  const objects = parseScene(await invoke<string>("read_text_file", { path: target }));
  const state = useEditor.getState();
  state.setObjects(objects);
  state.setFilePath(target);
  return target;
}

/** Eksporterer synlige objekter som GLB (kan åpnes i Blender, Roblox Studio, Unity, osv). */
export async function exportGlb(path?: string): Promise<string | null> {
  let target = path ?? null;
  if (!target) target = await save({ filters: [{ name: "glTF binær", extensions: ["glb"] }], defaultPath: "scene.glb" });
  if (!target) return null;

  // Rene kopier, slik at utvalgsomriss o.l. ikke blir med.
  const clones = sceneMeshes()
    .filter((m) => m.visible)
    .map((m) => {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.name = m.name;
      c.position.copy(m.position);
      c.quaternion.copy(m.quaternion);
      c.scale.copy(m.scale);
      return c;
    });
  if (!clones.length) throw new Error("Scenen er tom – ingenting å eksportere");

  const result = await new GLTFExporter().parseAsync(clones, { binary: true });
  const bytes = new Uint8Array(result as ArrayBuffer);
  await invoke("write_binary_file", { path: target, contents: Array.from(bytes) });
  return target;
}
