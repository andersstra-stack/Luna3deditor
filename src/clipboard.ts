import { useEditor } from "./store";
import { SHAPES, type SceneObject, type SerializedMesh, type SerializedTexture, type Vec3 } from "./types";
import {
  deserializeMesh,
  deserializeTexture,
  hasMesh,
  registerMesh,
  registerTexture,
  serializeUsedMeshes,
  serializeUsedTextures,
} from "./meshes";

/**
 * Kopier / klipp ut / lim inn av objekter via systemets utklippstavle (som JSON).
 * Bruker nettleserens copy/cut/paste-hendelser, så det trengs ingen tillatelser og
 * det virker også mellom to Luna 3D-vinduer.
 */
const FORMAT = "luna3d/objects";

interface ClipboardData {
  format: typeof FORMAT;
  objects: SceneObject[];
  /** Geometri for importerte modeller, så de kan limes inn i et annet vindu. */
  meshes?: SerializedMesh[];
  textures?: SerializedTexture[];
}

// Gjentatte innliminger av samme kopi forskyves 1 m hver gang, så de ikke havner oppå hverandre.
let lastText: string | null = null;
let lastWasCut = false;
let pasteCount = 0;

/** Lager utklippstekst av utvalget (og sletter det ved `cut`). Null hvis ingenting er valgt. */
export function copySelection(cut = false): string | null {
  const { objects, selectedIds, deleteObjects, setActivity } = useEditor.getState();
  const selected = objects.filter((o) => selectedIds.includes(o.id));
  if (!selected.length) return null;
  const text = JSON.stringify({
    format: FORMAT,
    objects: selected,
    meshes: serializeUsedMeshes(selected),
    textures: serializeUsedTextures(selected),
  } satisfies ClipboardData);
  lastText = text;
  lastWasCut = cut;
  pasteCount = 0;
  if (cut) deleteObjects(selected.map((o) => o.id));
  const what = selected.length === 1 ? selected[0].name : `${selected.length} objekter`;
  setActivity(`${cut ? "Klippet ut" : "Kopierte"} ${what}`);
  return text;
}

function parse(text: string): SceneObject[] | null {
  try {
    const data = JSON.parse(text) as Partial<ClipboardData>;
    if (data.format !== FORMAT || !Array.isArray(data.objects)) return null;
    for (const t of data.textures ?? []) registerTexture(deserializeTexture(t));
    for (const m of data.meshes ?? []) if (!hasMesh(m.id)) registerMesh(deserializeMesh(m));
    return data.objects.filter((o) => SHAPES.includes(o.type) && (o.type !== "mesh" || hasMesh(o.meshId)));
  } catch {
    return null;
  }
}

/** Limer inn objekter fra utklippsteksten. Returnerer false hvis teksten ikke er Luna 3D-objekter. */
export function pasteText(text: string): boolean {
  const items = parse(text);
  if (!items?.length) return false;

  if (text !== lastText) {
    // Kopiert i et annet vindu: lim inn på samme sted.
    lastText = text;
    lastWasCut = true;
    pasteCount = 0;
  }
  const step = (lastWasCut ? 0 : 1) + pasteCount++;
  const offset: Vec3 = [step, 0, 0];

  const state = useEditor.getState();
  const folderIds = new Set(state.folders.map((f) => f.id));
  const created = state.addObjects(
    items.map(({ id: _id, script: _script, ...o }) => ({
      ...o,
      position: o.position.map((v, i) => v + offset[i]) as Vec3,
      // Inn i den aktive mappa; ellers samme mappe som originalen hvis den finnes her.
      folderId: state.activeFolderId ?? (o.folderId && folderIds.has(o.folderId) ? o.folderId : null),
    })),
  );
  state.selectMany(created.map((c) => c.id));
  state.setActivity(`Limte inn ${created.length === 1 ? created[0].name : `${created.length} objekter`}`);
  return true;
}
