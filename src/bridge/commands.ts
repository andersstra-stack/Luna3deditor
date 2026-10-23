import { useEditor, type FolderUpdate } from "../store";
import { exportGlb, openScene, saveScene } from "../io";
import { importModelFile } from "../importer";
import { ADDABLE_SHAPES, type SceneObject, type ShapeType, type Vec3 } from "../types";
import { objectBox, round, type Axis } from "../bounds";
import { alignObjects, dropToGround, mirrorObjects, type AlignMode } from "../placement";
import { captureViewport, frameScene, VIEWS, type ViewName } from "../viewport/three-handle";
import type { BridgeMethod } from "./protocol";

type Params = Record<string, any>;
type Handler = (p: Params) => unknown | Promise<unknown>;

const editor = () => useEditor.getState();

function say(msg: string) {
  editor().setActivity(`Claude: ${msg}`);
}

function requireString(p: Params, key: string): string {
  if (typeof p[key] !== "string" || !p[key]) throw new Error(`Mangler parameter "${key}"`);
  return p[key];
}

function checkView(view: unknown): ViewName {
  const v = (view ?? "current") as ViewName;
  if (!VIEWS.includes(v)) throw new Error(`Ukjent visning "${v}". Gyldige: ${VIEWS.join(", ")}`);
  return v;
}

const summary = (o: SceneObject) => ({ id: o.id, name: o.name, type: o.type });

export const handlers: Record<BridgeMethod, Handler> = {
  get_scene: () => {
    const { objects, folders, selectedIds, filePath } = editor();
    // Nøyaktige omsluttende bokser (verdensrom) gjør det lett å plassere ting inntil hverandre.
    const withBounds = objects.map((o) => {
      const b = objectBox(o);
      return { ...o, bounds: { min: b.min.toArray().map((v) => round(v)), max: b.max.toArray().map((v) => round(v)) } };
    });
    return { folders, objects: withBounds, selectedIds, filePath };
  },

  add_objects: (p) => {
    const items = p.objects as (Partial<SceneObject> & { type: ShapeType })[];
    if (!Array.isArray(items) || !items.length) throw new Error("objects må være en ikke-tom liste");
    for (const i of items) {
      if (!ADDABLE_SHAPES.includes(i.type as (typeof ADDABLE_SHAPES)[number])) {
        throw new Error(i.type === "mesh" ? "Modeller legges til med import_model (eller duplicate_objects)" : `Ukjent type "${i.type}"`);
      }
    }
    // Claude må velge mappe eksplisitt – brukerens aktive mappe brukes ikke.
    const created = editor().addObjects(items.map((i) => ({ ...i, folderId: i.folderId ?? null })));
    say(created.length === 1 ? `la til ${created[0].name}` : `la til ${created.length} objekter`);
    return created.map(summary);
  },

  update_objects: (p) => {
    const updates = p.updates as (Partial<SceneObject> & { id: string })[];
    if (!Array.isArray(updates) || !updates.length) throw new Error("updates må være en ikke-tom liste");
    editor().updateObjects(updates);
    say(`endret ${updates.length} objekt${updates.length === 1 ? "" : "er"}`);
    return { updated: updates.map((u) => u.id) };
  },

  delete_objects: (p) => {
    const ids = p.ids as string[];
    const existing = new Set(editor().objects.map((o) => o.id));
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length) throw new Error(`Fant ikke: ${missing.join(", ")}`);
    editor().deleteObjects(ids);
    say(`slettet ${ids.length} objekt${ids.length === 1 ? "" : "er"}`);
    return { deleted: ids };
  },

  create_folders: (p) => {
    const items = p.folders as { name?: string; parentId?: string | null }[];
    if (!Array.isArray(items) || !items.length) throw new Error("folders må være en ikke-tom liste");
    const created = editor().addFolders(items);
    say(created.length === 1 ? `lagde mappen ${created[0].name}` : `lagde ${created.length} mapper`);
    return created.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId }));
  },

  update_folders: (p) => {
    const updates = p.updates as FolderUpdate[];
    if (!Array.isArray(updates) || !updates.length) throw new Error("updates må være en ikke-tom liste");
    editor().updateFolders(updates);
    say(`endret ${updates.length} mappe${updates.length === 1 ? "" : "r"}`);
    return { updated: updates.map((u) => u.id) };
  },

  delete_folders: (p) => {
    const ids = p.ids as string[];
    editor().deleteFolders(ids, p.deleteContents === true);
    say(`slettet ${ids.length} mappe${ids.length === 1 ? "" : "r"}`);
    return { deleted: ids, contentsDeleted: p.deleteContents === true };
  },

  select: (p) => {
    const ids = (p.ids ?? []) as string[];
    const missing = ids.filter((id) => !editor().objects.some((o) => o.id === id));
    if (missing.length) throw new Error(`Fant ikke: ${missing.join(", ")}`);
    editor().selectMany(ids);
    return { selectedIds: ids };
  },

  duplicate_objects: (p) => {
    const ids = p.ids as string[];
    const copies = editor().duplicateObjects(ids, (p.offset as Vec3 | undefined) ?? [1, 0, 0]);
    if (copies.length !== ids.length) throw new Error("Fant ikke alle objektene");
    say(`dupliserte ${copies.length} objekt${copies.length === 1 ? "" : "er"}`);
    return copies.map(summary);
  },

  drop_to_ground: (p) => {
    const result = dropToGround(p.ids as string[]);
    say("la objekter ned på underlaget");
    return result;
  },

  align_objects: (p) => {
    alignObjects(p.ids as string[], p.axis as Axis, p.mode as AlignMode, p.targetId as string | undefined);
    say("innrettet objekter");
    return { ok: true };
  },

  mirror_objects: (p) => {
    const ids = mirrorObjects(p.ids as string[], p.axis as Axis, p.copy === true, p.plane as number | undefined);
    say(p.copy ? "lagde speilkopier" : "speilet objekter");
    return { ids };
  },

  clear_scene: () => {
    editor().clearScene();
    say("tømte scenen");
    return { ok: true };
  },

  undo: () => {
    editor().undo();
    say("angret");
    return { objects: editor().objects.length };
  },

  redo: () => {
    editor().redo();
    say("gjorde om");
    return { objects: editor().objects.length };
  },

  set_view: (p) => {
    frameScene(checkView(p.view));
    return { ok: true };
  },

  screenshot: async (p) => {
    if (p.view && p.view !== "current") {
      frameScene(checkView(p.view));
    }
    return captureViewport(typeof p.width === "number" ? p.width : 1024);
  },

  save_scene: async (p) => {
    const path = await saveScene(requireString(p, "path"));
    say(`lagret ${path}`);
    return { path };
  },

  load_scene: async (p) => {
    const path = await openScene(requireString(p, "path"));
    say(`åpnet ${path}`);
    return { path, objects: editor().objects.length };
  },

  import_model: async (p) => {
    const result = await importModelFile(requireString(p, "path"), {
      folderId: (p.folderId as string | null | undefined) ?? null,
      position: p.position as Vec3 | undefined,
    });
    say(`importerte ${p.path}`);
    return result;
  },

  export_glb: async (p) => {
    const path = await exportGlb(requireString(p, "path"));
    say(`eksporterte ${path}`);
    return { path };
  },
};
