// Referansebilder fra appen: filvalg eller dra-og-slipp. Python og MCP leser fila selv og går rett på add_objects.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { registerTexture, textureIdOf } from "./meshes";
import { REFERENCE_HEIGHT, useEditor } from "./store";
import type { SceneObject, Vec3 } from "./types";
import { cameraState, viewTargetOnGround } from "./viewport/three-handle";

export const REFERENCE_EXTENSIONS = ["png", "jpg", "jpeg"];

function mimeOf(data: Uint8Array, name: string): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  throw new Error(`${name} er ikke PNG eller JPEG`);
}

/** Bildet vender mot kameraet, rettet inn etter nærmeste akse: ser du forfra, blir det et bilde forfra, og ser du fra siden, et fra siden. */
function facingCamera(): Vec3 {
  const { position, target } = cameraState();
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  if (Math.abs(dx) > Math.abs(dz)) return [0, dx > 0 ? 90 : -90, 0];
  return [0, dz >= 0 ? 0 : 180, 0];
}

/** Legger et bilde inn der kameraet ser, stående på bakken, og velger det. */
export function addReferenceImage(data: ArrayBuffer, fileName: string): SceneObject {
  const bytes = new Uint8Array(data);
  const mime = mimeOf(bytes, fileName);
  const id = textureIdOf(bytes);
  registerTexture({ id, mime, data: bytes });
  const state = useEditor.getState();
  const [x, z] = viewTargetOnGround();
  const [obj] = state.addObjects([
    {
      type: "reference",
      name: fileName.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""),
      texture: { id },
      position: [x, REFERENCE_HEIGHT / 2, z],
      rotation: facingCamera(),
      folderId: state.activeFolderId,
    },
  ]);
  state.selectMany([obj.id]);
  return obj;
}

/** Knappen i «Legg til»-menyen. */
export async function pickReferenceImage(): Promise<SceneObject | null> {
  const picked = await open({ filters: [{ name: "Bilde", extensions: REFERENCE_EXTENSIONS }], multiple: false });
  if (typeof picked !== "string") return null;
  return addReferenceImage(await invoke<ArrayBuffer>("read_binary_file", { path: picked }), picked);
}
