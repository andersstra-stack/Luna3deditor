// Animasjon fra fil (Mixamo-FBX, GLB/glTF) lagt på skjelettet i scenen: lese fila, overføre (retarget.ts) og legge
// klippet inn som ett angre-steg. Fra knappen i animasjonspanelet og MCP-verktøyet import_animation.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useEditor } from "./store";
import { isInside } from "./folders";
import { retargetAnimation, type RetargetOptions, type RetargetResult } from "./retarget";
import { isBone } from "./types";

export interface AnimationImportOptions extends RetargetOptions {
  /** Bare beina i denne mappa (og undermappene) – når flere figurer har hvert sitt skjelett. */
  folderId?: string | null;
}

/** Fildialog (flere filer kan velges) og import av hver; gir det siste klippet, så det kan vises med en gang. */
export async function pickAndImportAnimations(options: AnimationImportOptions = {}): Promise<(RetargetResult & { clipId: string }) | null> {
  const picked = await open({ filters: [{ name: "Animasjon (Mixamo FBX, GLB)", extensions: ["fbx", "glb", "gltf"] }], multiple: true });
  const files = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  let last: (RetargetResult & { clipId: string }) | null = null;
  for (const file of files) last = await importAnimationFile(file, options);
  if (files.length > 1) useEditor.getState().setActivity(`La ${files.length} animasjoner på skjelettet`);
  return last;
}

/** Leser en animasjonsfil til et three-objekt med `animations`. */
export async function loadAnimationSource(data: ArrayBuffer, path: string): Promise<THREE.Object3D> {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "fbx") return new FBXLoader().parse(data, "");
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().parseAsync(data, "");
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
  throw new Error(`Animasjoner leses fra FBX eller GLB/glTF, ikke .${ext}`);
}

/** Overfører animasjonen i fila til beina i scenen og legger den inn som klipp (et klipp med samme navn byttes ut). */
export async function importAnimationFile(path: string, options: AnimationImportOptions = {}): Promise<(RetargetResult & { clipId: string }) | null> {
  const target = path;
  const data = await invoke<ArrayBuffer>("read_binary_file", { path: target });
  const source = await loadAnimationSource(data, target);
  const state = useEditor.getState();
  const bones = state.objects.filter(
    (o) => isBone(o.type) && (!options.folderId || (o.folderId !== null && isInside(state.folders, o.folderId, options.folderId))),
  );
  if (!bones.length) throw new Error("Scenen har ingen bein å legge animasjonen på – lag et skjelett først (add_humanoid_skeleton)");
  const fileName = target.split(/[\\/]/).pop()!.replace(/\.(fbx|glb|gltf)$/i, "");
  // Mixamo kaller alle klipp «mixamo.com»: filnavnet er et bedre navn.
  const result = retargetAnimation(source, bones, { ...options, name: options.name ?? fileName });
  const clip = state.importClip({ name: result.name, duration: result.duration, loop: result.loop, tracks: result.tracks });
  state.setActivity(`La animasjonen «${result.name}» på ${result.mapped.length} bein (${result.duration} s, ${result.keys} nøkler)`);
  return { ...result, clipId: clip.id };
}
