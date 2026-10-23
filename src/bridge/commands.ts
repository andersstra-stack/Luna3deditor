import { useEditor } from "../store";
import { exportGlb, openScene, saveScene } from "../io";
import { SHAPES, type SceneObject, type ShapeType } from "../types";
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
    const { objects, selectedId, filePath } = editor();
    return { objects, selectedId, filePath };
  },

  add_objects: (p) => {
    const items = p.objects as (Partial<SceneObject> & { type: ShapeType })[];
    if (!Array.isArray(items) || !items.length) throw new Error("objects må være en ikke-tom liste");
    for (const i of items) if (!SHAPES.includes(i.type)) throw new Error(`Ukjent type "${i.type}"`);
    const created = editor().addObjects(items);
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

  select: (p) => {
    const id = (p.id ?? null) as string | null;
    if (id && !editor().objects.some((o) => o.id === id)) throw new Error(`Fant ikke objekt ${id}`);
    editor().select(id);
    return { selectedId: id };
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

  export_glb: async (p) => {
    const path = await exportGlb(requireString(p, "path"));
    say(`eksporterte ${path}`);
    return { path };
  },
};
