import { useEditor, type FolderUpdate, type NewObject } from "../store";
import { exportGlb, openScene, saveScene } from "../io";
import { importModelFile } from "../importer";
import { ADDABLE_SHAPES, type SceneObject, type ScriptOp, type ScriptResult, type ShapeType, type Vec3 } from "../types";
import * as THREE from "three";
import { round, type Axis } from "../bounds";
import { anchorNote, noteWorldPosition, topOf } from "../notes";
import { applyScriptOps, sceneForScripts } from "../scripting";
import { alignObjects, dropToGround, mirrorObjects, type AlignMode } from "../placement";
import { splitLooseParts } from "../meshSplit";
import { mergeObjects } from "../meshMerge";
import { usePlayer } from "../animationPlayer";
import type { AnimClip } from "../types";
import {
  cameraState,
  captureViewport,
  frameObjects,
  frameScene,
  raycast,
  restoreCamera,
  setCamera,
  VIEWS,
  type ViewName,
} from "../viewport/three-handle";
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

/** Så mange nye objekter vises med id i svaret til Claude; flere gir bare antallet (hundrevis av id-er koster mye). */
const SCRIPT_IDS_SHOWN = 25;

function compactScriptResult(r: ScriptResult) {
  if (r.created.length <= SCRIPT_IDS_SHOWN) return r;
  const folderIds = new Set(r.folders);
  const keys = Object.fromEntries(Object.entries(r.keys).filter(([, id]) => folderIds.has(id) || id.startsWith("fld")));
  return {
    ...r,
    created: r.created.length,
    keys,
    note: `${r.created.length} objects created – their ids are left out. Use get_scene or luna.objects(name=..., folder=...) to find them.`,
  };
}

/** En pinne etter id eller nummer. */
function findNote(ref: unknown) {
  const note = editor().notes.find((n) => n.id === ref || n.number === Number(ref));
  if (!note) throw new Error(`Fant ikke pinne ${ref}`);
  return note;
}

/** Et klipp etter id eller navn. */
function findClip(ref: unknown): AnimClip {
  const clip = editor().clips.find((c) => c.id === ref || c.name === ref);
  if (!clip) throw new Error(`Fant ikke animasjonsklipp «${ref}». Klipp: ${editor().clips.map((c) => c.name).join(", ") || "ingen"}`);
  return clip;
}

/** Navnet på et mål (objekt eller mappe) for svarene til Claude. */
function targetName(id: string) {
  const { objects, folders } = editor();
  return objects.find((o) => o.id === id)?.name ?? folders.find((f) => f.id === id)?.name ?? "(slettet)";
}

const clipSummary = (c: AnimClip) => ({
  id: c.id,
  name: c.name,
  duration: c.duration,
  loop: c.loop,
  tracks: c.tracks.map((t) => ({ target: t.target, targetName: targetName(t.target), keys: t.keys })),
});

export const handlers: Record<BridgeMethod, Handler> = {
  // Nøyaktige omsluttende bokser (verdensrom) gjør det lett å plassere ting inntil hverandre.
  get_scene: () => sceneForScripts(),

  get_notes: (p) => {
    const { notes, objects } = editor();
    const all = p.include_resolved === true;
    return notes
      .filter((n) => all || n.status === "open")
      .map((n) => {
        const obj = n.objectId ? objects.find((o) => o.id === n.objectId) : undefined;
        return {
          id: n.id,
          number: n.number,
          text: n.text,
          author: n.author,
          status: n.status,
          object: obj ? { id: obj.id, name: obj.name } : null,
          position: noteWorldPosition(n, objects).toArray().map((v) => round(v)),
          replies: n.replies,
        };
      });
  },

  add_note: (p) => {
    const text = requireString(p, "text");
    const state = editor();
    const obj = p.objectId ? state.objects.find((o) => o.id === p.objectId) : undefined;
    if (p.objectId && !obj) throw new Error(`Fant ikke objekt ${p.objectId}`);
    const point = p.position ? new THREE.Vector3(...(p.position as Vec3)) : obj ? topOf(obj) : null;
    if (!point) throw new Error("Oppgi objectId eller position");
    const note = state.addNote({ ...anchorNote(point, obj), text, author: "claude" });
    state.setShowNotes(true);
    say(`satte pinne ${note.number}`);
    return { id: note.id, number: note.number };
  },

  reply_to_note: (p) => {
    const note = findNote(p.note);
    if (typeof p.text === "string" && p.text.trim()) editor().replyToNote(note.id, { author: "claude", text: p.text.trim() });
    if (p.status === "open" || p.status === "done") editor().updateNote(note.id, { status: p.status });
    say(p.status === "done" ? `løste pinne ${note.number}` : `svarte på pinne ${note.number}`);
    return { id: note.id, number: note.number, status: editor().notes.find((n) => n.id === note.id)?.status };
  },

  delete_notes: (p) => {
    const ids = (p.notes as (string | number)[]).map((ref) => findNote(ref).id);
    editor().deleteNotes(ids);
    return { deleted: ids.length };
  },

  apply_script: (p) => {
    const ops = p.ops as ScriptOp[];
    if (!Array.isArray(ops)) throw new Error("ops må være en liste");
    return compactScriptResult(applyScriptOps(ops, (p.name as string | undefined) ?? "Claude-skript", p.script as string | undefined));
  },

  add_objects: (p) => {
    const items = p.objects as (Partial<SceneObject> & { type: ShapeType })[];
    if (!Array.isArray(items) || !items.length) throw new Error("objects må være en ikke-tom liste");
    for (const i of items) {
      const customMesh = i.type === "mesh" && (i as NewObject).vertices !== undefined;
      if (!customMesh && !ADDABLE_SHAPES.includes(i.type as (typeof ADDABLE_SHAPES)[number])) {
        throw new Error(
          i.type === "mesh" ? "Modeller lages med vertices + triangles, import_model eller duplicate_objects" : `Ukjent type "${i.type}"`,
        );
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

  split_loose_parts: (p) => {
    const ids = p.ids as string[];
    if (!Array.isArray(ids) || !ids.length) throw new Error("ids må være en ikke-tom liste");
    const result = splitLooseParts(ids);
    say(result.split.length ? `delte ${result.split.map((s) => s.name).join(", ")} i løse deler` : "fant ingenting å dele");
    return result;
  },

  merge_objects: (p) => {
    const ids = p.ids as string[];
    if (!Array.isArray(ids) || ids.length < 2) throw new Error("ids må ha minst to objekter");
    const result = mergeObjects(ids);
    say(`slo sammen ${result.merged} deler til ${result.name}`);
    return result;
  },

  animate: (p) => {
    const target = requireString(p, "target");
    const clips = editor().addAnimation(target, p.preset, {
      axis: p.axis,
      amount: p.amount,
      duration: p.duration,
      clip: p.clip,
    });
    const touched = clips.filter((c) => c.tracks.some((t) => t.target === target));
    say(`animerte ${targetName(target)} (${touched.map((c) => c.name).join(", ")})`);
    return touched.map(clipSummary);
  },

  set_keyframes: (p) => {
    const clip = editor().setKeyframes(requireString(p, "clip"), requireString(p, "target"), p.keys, {
      duration: p.duration,
      loop: p.loop,
    });
    say(`satte nøkkelrammer i «${clip.name}»`);
    return clipSummary(clip);
  },

  get_animations: () => editor().clips.map(clipSummary),

  delete_animations: (p) => {
    if (typeof p.target === "string") {
      editor().removeAnimations(p.target);
      return { removedFrom: targetName(p.target) };
    }
    const clips = ((p.clips ?? []) as string[]).map(findClip);
    if (!clips.length) throw new Error("Oppgi clips (navn eller id-er) eller target");
    editor().deleteClips(clips.map((c) => c.id));
    say(`slettet ${clips.length} animasjonsklipp`);
    return { deleted: clips.map((c) => c.name) };
  },

  preview_animation: (p) => {
    const player = usePlayer.getState();
    if (p.clip === null || p.clip === undefined) {
      player.select(null);
      return { clip: null, note: "Showing the rest pose (as saved)." };
    }
    const clip = findClip(p.clip);
    if (usePlayer.getState().clipId !== clip.id) player.select(clip.id);
    usePlayer.getState().setTime(typeof p.time === "number" ? p.time : 0);
    if (p.play === true) usePlayer.getState().play();
    else usePlayer.getState().pause();
    const s = usePlayer.getState();
    return { clip: clip.name, time: s.time, duration: clip.duration, playing: s.playing };
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
    if (Array.isArray(p.focus) && p.focus.length) frameObjects(p.focus, checkView(p.view), typeof p.zoom === "number" ? p.zoom : 1);
    else frameScene(checkView(p.view));
    return { ok: true };
  },

  screenshot: async (p) => {
    // Eget kamera eller fokus: brukerens kamera settes tilbake etterpå (med mindre keep_view).
    const saved = cameraState();
    const custom = !!p.camera || (Array.isArray(p.focus) && p.focus.length > 0);
    if (p.camera) {
      const c = p.camera as { position: Vec3; target: Vec3; fov?: number };
      setCamera(c.position, c.target, c.fov);
    } else if (custom) {
      frameObjects(p.focus as string[], checkView(p.view), typeof p.zoom === "number" ? p.zoom : 1);
    } else if (p.view && p.view !== "current") {
      frameScene(checkView(p.view));
    }
    try {
      return await captureViewport(typeof p.width === "number" ? p.width : 1024);
    } finally {
      if (custom && p.keep_view !== true) restoreCamera(saved);
    }
  },

  raycast: (p) => {
    const one = (r: Params) => {
      const origin = r.origin as Vec3;
      if (!Array.isArray(origin) || origin.length !== 3) throw new Error("origin må være [x, y, z]");
      const hits = raycast(origin, (r.direction as Vec3 | undefined) ?? [0, -1, 0], {
        maxDistance: (r.max_distance ?? p.max_distance) as number | undefined,
        ignore: p.ignore as string[] | undefined,
        all: p.all === true,
      });
      return p.all === true ? hits : (hits[0] ?? null);
    };
    return Array.isArray(p.rays) ? (p.rays as Params[]).map(one) : one(p);
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
      // Uten parameter gjelder brukerens innstilling.
      keepOrigin: p.keep_origin as boolean | undefined,
    });
    say(`importerte ${p.path}`);
    return result;
  },

  export_glb: async (p) => {
    const result = await exportGlb(requireString(p, "path"));
    say(`eksporterte ${result?.path}`);
    return result;
  },
};
