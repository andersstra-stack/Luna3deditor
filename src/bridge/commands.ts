import { useEditor, type FolderUpdate, type NewObject } from "../store";
import { exportGlb, openScene, saveScene, writeBinaryFile } from "../io";
import { importModelFile } from "../importer";
import { ADDABLE_SHAPES, type SceneObject, type ScriptOp, type ScriptResult, type ShapeType, type Vec3 } from "../types";
import * as THREE from "three";
import { round, type Axis } from "../bounds";
import { anchorNote, noteWorldPosition, topOf } from "../notes";
import { applyScriptOps, sceneForScripts } from "../scripting";
import { alignObjects, dropToGround, mirrorObjects, type AlignMode } from "../placement";
import { splitLooseParts } from "../meshSplit";
import { mergeObjects } from "../meshMerge";
import { simplifierReady } from "../meshSimplify";
import { importAnimationFile } from "../animationImport";
import { usePlayer } from "../animationPlayer";
import type { AnimClip } from "../types";
import {
  cameraState,
  captureViewport,
  frameObjects,
  frameScene,
  raycast,
  renderIcon,
  restoreCamera,
  setCamera,
  VIEWS,
  type ViewName,
} from "../viewport/three-handle";
import { openWindow } from "../windows";
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

  apply_script: async (p) => {
    const ops = p.ops as ScriptOp[];
    if (!Array.isArray(ops)) throw new Error("ops må være en liste");
    return compactScriptResult(await applyScriptOps(ops, (p.name as string | undefined) ?? "Claude-skript", p.script as string | undefined));
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

  simplify_mesh: async (p) => {
    const ids = p.ids as string[];
    if (!Array.isArray(ids) || !ids.length) throw new Error("ids må være en ikke-tom liste");
    if (p.ratio === undefined && p.triangles === undefined) throw new Error("Oppgi ratio (andel som blir igjen) eller triangles (antall)");
    await simplifierReady;
    const result = editor().simplifyObjects(ids, { ratio: p.ratio, triangles: p.triangles, maxError: p.max_error });
    const n = result.simplified.reduce((sum, s) => sum + s.before - s.after, 0);
    say(result.simplified.length ? `forenklet ${result.simplified.map((s) => s.name).join(", ")} (${n} færre trekanter)` : "fant ingenting å forenkle");
    return result;
  },

  skin_mesh: (p) => {
    const ids = p.ids as string[];
    if (!Array.isArray(ids) || !ids.length) throw new Error("ids må være en ikke-tom liste");
    const bones = Array.isArray(p.bones) && p.bones.length ? (p.bones as string[]) : undefined;
    const result = editor().skinObjects(ids, bones);
    say(result.skinned.length ? `bandt ${result.skinned.map((s) => s.name).join(", ")} til skjelettet` : "fant ingenting å binde");
    return result;
  },

  add_humanoid_skeleton: (p) => {
    const ids = p.ids as string[];
    if (!Array.isArray(ids) || !ids.length) throw new Error("ids må være en ikke-tom liste (modellene som er figuren)");
    const result = editor().applyScript([{ op: "humanoid", meshes: ids, folder: (p.folderId as string | undefined) ?? null }]);
    const bones = editor().objects.filter((o) => result.created.includes(o.id));
    say(`lagde et skjelett med ${bones.length} bein`);
    return {
      folderId: result.folders[0] ?? p.folderId ?? null,
      bones: bones.map((b) => ({ id: b.id, name: b.name, parent: bones.find((x) => x.id === b.parentId)?.name ?? null })),
      note: "Check with a screenshot (bones show through the mesh), adjust with update_objects head/tail if needed, then skin_mesh.",
    };
  },

  rig_character: async (p) => {
    // Hele veien fra fil til figur som kan spilles av: import (med høyde) → menneskeskjelett → binding → animasjoner.
    let ids = p.ids as string[] | undefined;
    let folderId: string | null = null;
    if (typeof p.path === "string") {
      const name = p.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      folderId = editor().addFolders([{ name }])[0].id;
      const imported = await importModelFile(p.path, {
        folderId,
        position: (p.position as Vec3 | undefined) ?? [0, 0, 0],
        keepOrigin: false,
        height: (p.height as number | undefined) ?? 1.8,
      });
      if (!imported) throw new Error(`Kunne ikke importere ${p.path}`);
      ids = imported.objectIds;
      // Én mesh får filnavnet (Tripo o.l. kaller den «tripo_node_…»).
      if (ids.length === 1) editor().updateObjects([{ id: ids[0], name }]);
      // En modell i flere deler får sin egen mappe; den legges i figurens mappe.
      if (imported.folderId && imported.folderId !== folderId) editor().updateFolders([{ id: imported.folderId, parentId: folderId }]);
    }
    if (!ids?.length) throw new Error("Oppgi path (modellfil) eller ids (modellene i scenen)");
    const meshes = editor().objects.filter((o) => ids!.includes(o.id) && o.type === "mesh");
    if (!meshes.length) throw new Error("Fant ingen modeller (type mesh) å rigge");
    const skeleton = editor().applyScript([{ op: "humanoid", meshes: meshes.map((o) => o.id), folder: null }]);
    const bones = skeleton.created;
    const skin = editor().skinObjects(
      meshes.map((o) => o.id),
      bones,
    );
    const skeletonFolder = skeleton.folders[0] ?? null;
    const clips = [];
    for (const path of (p.animations as string[] | undefined) ?? []) {
      const r = await importAnimationFile(path, { folderId: skeletonFolder, inPlace: p.in_place === true });
      if (r) clips.push({ clip: r.name, duration: r.duration, keys: r.keys });
    }
    say(`rigget ${meshes.length === 1 ? meshes[0].name : `${meshes.length} modeller`} (${bones.length} bein, ${clips.length} animasjoner)`);
    return {
      folderId: folderId ?? meshes[0].folderId,
      meshes: meshes.map((o) => ({ id: o.id, name: o.name })),
      skeletonFolderId: skeletonFolder,
      bones: bones.length,
      skinned: skin.skinned.length,
      clips,
      note: "Check with screenshot (+ preview_animation). Adjust a bone with update_objects head/tail and re-run skin_mesh if needed.",
    };
  },

  import_animation: async (p) => {
    // Huben gjør en mappe om til en liste med filer (appen kan ikke lese mapper).
    const paths = Array.isArray(p.paths) ? (p.paths as string[]) : [requireString(p, "path")];
    if (!paths.length) throw new Error("Ingen animasjonsfiler");
    if (p.clip && paths.length > 1) throw new Error("clip (navnet) gjelder bare én fil – klippene får ellers filnavnet");
    const clips = [];
    for (const path of paths) {
      const result = await importAnimationFile(path, {
        name: p.clip as string | undefined,
        inPlace: p.in_place === true,
        loop: p.loop as boolean | undefined,
        fps: p.fps as number | undefined,
        folderId: p.folderId as string | undefined,
      });
      if (!result) throw new Error(`Kunne ikke lese ${path}`);
      clips.push({
        clip: result.name,
        duration: result.duration,
        bones: result.mapped.length,
        keys: result.keys,
        ...(result.unmapped.length ? { unmapped: result.unmapped } : {}),
      });
    }
    say(clips.length === 1 ? `la animasjonen «${clips[0].clip}» på skjelettet` : `la ${clips.length} animasjoner på skjelettet`);
    return { clips };
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

  set_lighting: (p) => {
    const given = <T,>(key: string, name: string) => (p[key] !== undefined ? { [name]: p[key] as T } : {});
    const l = editor().setLighting({
      ...given<string>("preset", "preset"),
      ...given<number>("ambient", "ambient"),
      ...given<number>("sun", "sun"),
      ...given<number>("sun_azimuth", "sunAzimuth"),
      ...given<number>("sun_elevation", "sunElevation"),
      ...given<string>("sun_color", "sunColor"),
      ...given<number>("fill", "fill"),
      ...given<number>("rim", "rim"),
      ...given<number>("environment", "environment"),
    });
    return {
      preset: l.preset,
      ambient: l.ambient,
      sun: l.sun,
      sun_azimuth: l.sunAzimuth,
      sun_elevation: l.sunElevation,
      sun_color: l.sunColor,
      fill: l.fill,
      rim: l.rim,
      environment: l.environment,
    };
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

  render_icon: async (p) => {
    const view = checkView(p.view ?? "iso");
    if (view === "current") throw new Error('render_icon trenger en fast retning (iso, front, top …), ikke "current"');
    const icon = await renderIcon({
      ids: Array.isArray(p.ids) ? (p.ids as string[]) : undefined,
      view,
      size: typeof p.size === "number" ? p.size : undefined,
      padding: typeof p.padding === "number" ? p.padding : undefined,
      background: typeof p.background === "string" ? p.background : undefined,
    });
    const path = typeof p.path === "string" && p.path ? p.path : null;
    if (path) {
      if (!/\.png$/i.test(path)) throw new Error("path må slutte på .png");
      const bytes = Uint8Array.from(atob(icon.base64), (c) => c.charCodeAt(0));
      await writeBinaryFile(path, bytes);
      say(`lagret ikon ${path.split(/[\\/]/).pop()}`);
    }
    return { ...icon, path };
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

  open_window: async (p) => {
    const path = typeof p.path === "string" ? p.path : undefined;
    const window = await openWindow(path);
    say(path ? `åpnet ${path.split(/[\\/]/).pop()} i nytt vindu` : "åpnet nytt vindu");
    return { window };
  },

  import_model: async (p) => {
    const result = await importModelFile(requireString(p, "path"), {
      folderId: (p.folderId as string | null | undefined) ?? null,
      position: p.position as Vec3 | undefined,
      // Uten parameter gjelder brukerens innstilling.
      keepOrigin: p.keep_origin as boolean | undefined,
      height: p.height as number | undefined,
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
