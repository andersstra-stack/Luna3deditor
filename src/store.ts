import { create } from "zustand";
import {
  ADDABLE_SHAPES,
  DEFAULT_COLORS,
  DEFAULT_INTENSITY,
  DEFAULT_SCALE,
  SHAPE_LABELS,
  isLight,
  isNode,
  startHeight,
  type AnimClip,
  type Folder,
  type Note,
  type NoteReply,
  type SceneObject,
  type ScriptOp,
  type ScriptResult,
  type ShapeType,
  type TransformMode,
  type Vec3,
} from "./types";
import { folderChain, isInside } from "./folders";
import { uniqueNodeName } from "./nodes";
import { newCurveProps, placeCurve, reshapeCurve } from "./curves";
import { meshFromVertices, singleVertexColor, type MeshInput } from "./customMesh";
import { hasMesh } from "./meshes";
import { PRESETS, checkKeys, presetClips, withTrack, type Preset, type PresetOptions } from "./animation";

const HISTORY_LIMIT = 100;

export type BridgeStatus = "disconnected" | "connected" | "busy";

/** Det som angres/gjøres om. */
export interface Snapshot {
  objects: SceneObject[];
  folders: Folder[];
  notes: Note[];
  /** Animasjonsklipp (se animation.ts). */
  clips: AnimClip[];
}

export type Tool = "select" | "note";

/** Kun kurverør: punktene i verdensrommet og radius (ett tall eller ett per punkt) – se curves.ts. */
export type CurveInput = { points?: Vec3[]; radius?: number | number[] };
export type NewObject = Partial<SceneObject> & CurveInput & MeshInput & { type: ShapeType };
export type ObjectUpdate = Partial<SceneObject> & CurveInput & { id: string };
export type FolderUpdate = Partial<Omit<Folder, "id">> & { id: string };
export type SelectMode = "replace" | "toggle" | "add";

export interface EditorState extends Snapshot {
  /** Valgte objekter; det siste er "hovedvalget" (vises i egenskapspanelet). */
  selectedIds: string[];
  /** Mappen nye objekter og mapper havner i fra verktøylinja. */
  activeFolderId: string | null;
  /** Sammenslåtte mapper i scenelista (ren visning, ikke i historikken). */
  collapsed: Record<string, boolean>;
  transformMode: TransformMode;
  /** Fest til rutenett. */
  snap: boolean;
  /** Fest til andre objekter (flater legger seg inntil hverandre). */
  objectSnap: boolean;
  past: Snapshot[];
  future: Snapshot[];
  bridgeStatus: BridgeStatus;
  /** Aktivt verktøy i 3D-visningen: velge, eller sette kommentar-pinner. */
  tool: Tool;
  /** Pinnen som har kortet sitt åpent (og om teksten redigeres). */
  activeNoteId: string | null;
  editingNoteId: string | null;
  showNotes: boolean;
  showResolvedNotes: boolean;
  /** Kort melding nederst i vinduet, f.eks. "Claude la til Kube". */
  activity: string | null;
  filePath: string | null;
  /** Scenen slik den var sist den ble lagret eller åpnet – sammenlignes med referanser, se `hasUnsavedChanges`. */
  saved: Snapshot;

  addObject: (type: ShapeType, props?: Partial<SceneObject>) => SceneObject;
  addObjects: (items: NewObject[]) => SceneObject[];
  updateObject: (id: string, props: Partial<SceneObject> & CurveInput) => void;
  updateObjects: (updates: ObjectUpdate[]) => void;
  /** Oppdatering uten historikk – brukes mens gizmoen dras. */
  updateObjectLive: (id: string, props: Partial<SceneObject> & CurveInput) => void;
  updateObjectsLive: (updates: ObjectUpdate[]) => void;
  deleteObjects: (ids: string[]) => void;
  duplicateObjects: (ids: string[], offset?: Vec3) => SceneObject[];
  /** Fjerner `ids` og legger til `items` som ett angre-steg (f.eks. en modell delt i biter). De nye velges. */
  replaceObjects: (ids: string[], items: NewObject[]) => SceneObject[];

  addFolders: (items: { name?: string; parentId?: string | null; model?: boolean }[]) => Folder[];
  updateFolders: (updates: FolderUpdate[]) => void;
  /** Uten `deleteContents` flyttes innholdet opp til overordnet mappe. */
  deleteFolders: (ids: string[], deleteContents?: boolean) => void;
  /** Flytter objekter og/eller mapper inn i `target` (null = roten). */
  moveToFolder: (items: { objectIds?: string[]; folderIds?: string[] }, target: string | null) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  setActiveFolder: (id: string | null) => void;

  /** Bruker endringene fra et Python-skript som ett angre-steg. */
  applyScript: (ops: ScriptOp[], script?: string) => ScriptResult;
  addNote: (note: Pick<Note, "position" | "objectId" | "local" | "text" | "author">) => Note;
  updateNote: (id: string, props: Partial<Pick<Note, "text" | "status">>) => void;
  replyToNote: (id: string, reply: Omit<NoteReply, "at">) => void;
  deleteNotes: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  openNote: (id: string | null, editing?: boolean) => void;
  setShowNotes: (show: boolean) => void;
  setShowResolvedNotes: (show: boolean) => void;
  /** Ferdig bevegelse (snurr, svai, hopp, åpne/lukke) på et objekt eller en mappe – byttes ut hvis målet har den fra før. */
  addAnimation: (target: string, preset: Preset, options?: PresetOptions) => AnimClip[];
  /** Egne nøkkelrammer for et mål i et klipp (lages om det ikke finnes). */
  setKeyframes: (clip: string, target: string, keys: unknown, options?: { duration?: number; loop?: boolean }) => AnimClip;
  updateClip: (id: string, props: Partial<Pick<AnimClip, "name" | "duration" | "loop">>) => void;
  deleteClips: (ids: string[]) => void;
  /** Klippene uten angre-steg – brukes mens gizmoen eller en nøkkelramme dras (med `pushHistory()` ved start). */
  setClipsLive: (clips: AnimClip[]) => void;
  /** Fjerner all animasjon fra et mål (tomme klipp slettes). */
  removeAnimations: (target: string) => void;
  setScene: (scene: Partial<Snapshot> & Pick<Snapshot, "objects" | "folders">) => void;
  clearScene: () => void;
  select: (id: string | null, mode?: SelectMode) => void;
  selectMany: (ids: string[]) => void;
  /** Velger alt i mappa (også undermapper) og gjør den aktiv. */
  selectFolder: (id: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  toggleSnap: () => void;
  toggleObjectSnap: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  setBridgeStatus: (status: BridgeStatus) => void;
  setActivity: (msg: string | null) => void;
  setFilePath: (path: string | null) => void;
  /** Nåværende scene regnes som lagret (etter lagring, åpning eller ny scene). */
  markSaved: () => void;
}

let counter = 0;
export const newId = (prefix = "obj") => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/**
 * Er scenen endret siden den sist ble lagret eller åpnet? Tilstanden er uforanderlig, så nye referanser betyr endringer
 * (og angre tilbake til lagret tilstand gir de samme referansene igjen). En tom scene uten fil har ingenting å miste.
 */
export function hasUnsavedChanges(s: Pick<EditorState, keyof Snapshot | "saved" | "filePath">): boolean {
  const changed =
    s.objects !== s.saved.objects || s.folders !== s.saved.folders || s.notes !== s.saved.notes || s.clips !== s.saved.clips;
  return changed && !(s.filePath === null && !s.objects.length && !s.folders.length && !s.notes.length && !s.clips.length);
}

/** Hovedvalget (sist valgte objekt). */
export const primaryId = (s: { selectedIds: string[] }) => s.selectedIds[s.selectedIds.length - 1] ?? null;

/** Mapper som ligger i `parentId` – mappenavn trenger bare være unike blant søsken, som i et filtre. */
const siblings = (folders: Folder[], parentId: string | null | undefined) => folders.filter((f) => f.parentId === (parentId ?? null));

function uniqueName(base: string, taken: { name: string }[]): string {
  const names = new Set(taken.map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function makeObject(type: ShapeType, existing: SceneObject[], props: Partial<SceneObject> & CurveInput & MeshInput = {}): SceneObject {
  const { id: _ignored, type: _type, name: _name, points, radius, vertices, triangles, vertex_colors, smooth, ...rest } = props;
  if ((points !== undefined || radius !== undefined) && type !== "curve") throw new Error("points og radius gjelder bare kurverør (type curve)");
  if (vertices !== undefined && type !== "mesh") throw new Error("vertices og triangles gjelder bare egne former (type mesh)");
  // Egen form fra hjørner og trekanter: geometrien registreres, plassering og mål regnes ut fra hjørnene.
  const custom = vertices !== undefined ? { vertices, triangles, vertex_colors, smooth } : undefined;
  if (custom) {
    Object.assign(rest, meshFromVertices(custom, rest.position, rest.rotation, props.name));
    rest.color ??= singleVertexColor(custom);
  }
  if (type === "mesh" && !hasMesh(rest.meshId)) throw new Error("En modell trenger meshId (import) eller vertices + triangles");
  const scale = DEFAULT_SCALE[type] ?? [1, 1, 1];
  const y = startHeight(type, scale);
  return {
    id: newId(),
    name: isNode(type) ? uniqueNodeName(props.name ?? "node", existing) : uniqueName(props.name ?? SHAPE_LABELS[type], existing),
    position: [0, y, 0],
    rotation: [0, 0, 0],
    scale: [...scale],
    color: isLight(type) ? "#fff2d6" : isNode(type) ? "#ff9e64" : DEFAULT_COLORS[existing.length % DEFAULT_COLORS.length],
    metalness: 0,
    roughness: 0.5,
    opacity: 1,
    visible: true,
    folderId: null,
    ...(isLight(type) ? { intensity: DEFAULT_INTENSITY[type] } : {}),
    ...rest,
    ...(type === "curve" ? newCurveProps({ ...rest, points, radius }) : {}),
    type,
  };
}

function assertFolder(folders: Folder[], id: string | null | undefined) {
  if (id && !folders.some((f) => f.id === id)) throw new Error(`Fant ikke mappe ${id}`);
}

/** Ett objekt med endringene. Nye kurvepunkter (verdensrom) eller ny radius regner om posisjon og størrelse. */
function withUpdate(o: SceneObject, update: Partial<SceneObject> & CurveInput): SceneObject {
  if ("vertices" in update || "triangles" in update) throw new Error(`Formen til ${o.name} kan ikke endres – lag et nytt objekt med vertices`);
  const { points, radius, ...props } = update;
  const next = { ...o, ...props, id: o.id, type: o.type };
  if (points === undefined && radius === undefined) return next;
  if (o.type !== "curve") throw new Error(`points og radius gjelder bare kurverør – ${o.name} er ${o.type}`);
  return { ...next, ...(points !== undefined ? placeCurve(points, radius ?? o.curve?.radius ?? 0.1) : reshapeCurve(next, radius)) };
}

const applyUpdates = (objects: SceneObject[], updates: ObjectUpdate[]) => {
  const byId = new Map(updates.map((u) => [u.id, u]));
  return objects.map((o) => (byId.has(o.id) ? withUpdate(o, byId.get(o.id)!) : o));
};

export const useEditor = create<EditorState>((set, get) => {
  const empty: Snapshot = { objects: [], folders: [], notes: [], clips: [] };
  const snapshot = (): Snapshot => ({ objects: get().objects, folders: get().folders, notes: get().notes, clips: get().clips });

  /** Målet (objekt eller mappe) må finnes. */
  const assertTarget = (target: string, objects = get().objects, folders = get().folders) => {
    if (!objects.some((o) => o.id === target) && !folders.some((f) => f.id === target)) throw new Error(`Fant ikke objekt eller mappe ${target}`);
  };
  const presetInto = (clips: AnimClip[], target: string, preset: string, options: PresetOptions = {}) => {
    if (!(PRESETS as readonly string[]).includes(preset)) throw new Error(`Ukjent bevegelse «${preset}». Gyldige: ${PRESETS.join(", ")}`);
    return presetClips(preset as Preset, options).reduce((acc, part) => withTrack(acc, part, target, () => newId("clip")), clips);
  };
  const keyframesInto = (clips: AnimClip[], name: string, target: string, keys: unknown, options: { duration?: number; loop?: boolean } = {}) => {
    if (!name?.trim()) throw new Error("Klippet trenger et navn");
    const ks = checkKeys(keys);
    const old = clips.find((c) => c.name === name);
    const duration = options.duration ?? Math.max(ks[ks.length - 1].t, old?.duration ?? 0);
    if (!(duration > 0)) throw new Error("duration må være over 0 (eller ha en nøkkelramme etter t = 0)");
    return withTrack(clips, { name, duration, loop: options.loop ?? old?.loop ?? false, keys: ks }, target, () => newId("clip"));
  };

  /** Lagrer nåværende tilstand i angre-historikken før en endring. */
  const commit = (next: Partial<Snapshot>, extra: Partial<EditorState> = {}) => {
    set({ past: [...get().past, snapshot()].slice(-HISTORY_LIMIT), future: [], ...next, ...extra });
  };

  /** Fjerner valg som peker på objekter som ikke finnes lenger. */
  const keepSelection = (objects: SceneObject[]) => {
    const ids = new Set(objects.map((o) => o.id));
    return get().selectedIds.filter((id) => ids.has(id));
  };

  /** Etter angre/gjør om kan utvalg og aktiv mappe peke på noe som ikke finnes lenger. */
  const restore = (snap: Snapshot): Partial<EditorState> => {
    const { activeFolderId } = get();
    return {
      ...snap,
      notes: snap.notes ?? [],
      clips: snap.clips ?? [],
      activeNoteId: (snap.notes ?? []).some((n) => n.id === get().activeNoteId) ? get().activeNoteId : null,
      selectedIds: keepSelection(snap.objects),
      activeFolderId: snap.folders.some((f) => f.id === activeFolderId) ? activeFolderId : null,
    };
  };

  return {
    ...empty,
    saved: empty,
    selectedIds: [],
    activeFolderId: null,
    collapsed: {},
    transformMode: "translate",
    snap: false,
    objectSnap: true,
    past: [],
    future: [],
    bridgeStatus: "disconnected",
    tool: "select",
    activeNoteId: null,
    editingNoteId: null,
    showNotes: true,
    showResolvedNotes: false,
    activity: null,
    filePath: null,

    addObject: (type, props) => get().addObjects([{ ...props, type }])[0],

    addObjects: (items) => {
      const { folders } = get();
      for (const item of items) assertFolder(folders, item.folderId);
      const all = [...get().objects];
      const created: SceneObject[] = [];
      for (const item of items) {
        const obj = makeObject(item.type, all, item);
        all.push(obj);
        created.push(obj);
      }
      const last = created[created.length - 1];
      commit({ objects: all }, last ? { selectedIds: [last.id] } : {});
      return created;
    },

    updateObject: (id, props) => get().updateObjects([{ ...props, id }]),

    updateObjects: (updates) => {
      const { objects, folders } = get();
      const missing = updates.filter((u) => !objects.some((o) => o.id === u.id));
      if (missing.length) throw new Error(`Fant ikke objekt(er): ${missing.map((m) => m.id).join(", ")}`);
      for (const u of updates) assertFolder(folders, u.folderId);
      commit({ objects: applyUpdates(objects, updates) });
    },

    updateObjectLive: (id, props) => get().updateObjectsLive([{ ...props, id }]),
    updateObjectsLive: (updates) => set({ objects: applyUpdates(get().objects, updates) }),

    deleteObjects: (ids) => {
      const remove = new Set(ids);
      commit(
        { objects: get().objects.filter((o) => !remove.has(o.id)) },
        { selectedIds: get().selectedIds.filter((id) => !remove.has(id)) },
      );
    },

    duplicateObjects: (ids, offset = [1, 0, 0]) => {
      const all = [...get().objects];
      const copies: SceneObject[] = [];
      for (const id of ids) {
        const src = all.find((o) => o.id === id);
        if (!src) continue;
        const copy = makeObject(src.type, all, {
          ...src,
          // Noder får neste nummer (hp_01 → hp_02), se uniqueNodeName.
          name: isNode(src.type) ? src.name : src.name.replace(/ \d+$/, ""),
          script: undefined,
          position: src.position.map((v, i) => v + offset[i]) as Vec3,
        });
        all.push(copy);
        copies.push(copy);
      }
      if (copies.length) commit({ objects: all }, { selectedIds: copies.map((c) => c.id) });
      return copies;
    },

    replaceObjects: (ids, items) => {
      const remove = new Set(ids);
      const all = get().objects.filter((o) => !remove.has(o.id));
      const created: SceneObject[] = [];
      for (const item of items) {
        const obj = makeObject(item.type, all, item);
        all.push(obj);
        created.push(obj);
      }
      commit({ objects: all }, { selectedIds: created.map((o) => o.id) });
      return created;
    },

    addFolders: (items) => {
      const all = [...get().folders];
      const created: Folder[] = [];
      for (const item of items) {
        assertFolder(all, item.parentId);
        const folder: Folder = {
          id: newId("fld"),
          name: uniqueName(item.name?.trim() || "Ny mappe", siblings(all, item.parentId)),
          parentId: item.parentId ?? null,
          visible: true,
          ...(item.model ? { model: true } : {}),
        };
        all.push(folder);
        created.push(folder);
      }
      commit({ folders: all });
      return created;
    },

    updateFolders: (updates) => {
      let folders = get().folders;
      for (const u of updates) {
        if (!folders.some((f) => f.id === u.id)) throw new Error(`Fant ikke mappe ${u.id}`);
        if (u.parentId !== undefined) {
          assertFolder(folders, u.parentId);
          if (u.parentId && isInside(folders, u.parentId, u.id)) {
            throw new Error("En mappe kan ikke flyttes inn i seg selv eller en av sine undermapper");
          }
        }
        // Brukes fortløpende slik at sykel-sjekken ser tidligere oppdateringer i samme kall.
        folders = folders.map((f) => (f.id === u.id ? { ...f, ...u, id: f.id } : f));
      }
      commit({ folders });
    },

    deleteFolders: (ids, deleteContents = false) => {
      const { folders, objects, activeFolderId } = get();
      ids.forEach((id) => assertFolder(folders, id));
      const remove = new Set(ids);
      let nextFolders: Folder[];
      let nextObjects: SceneObject[];

      if (deleteContents) {
        // Også alle undermapper og alt som ligger i dem.
        for (const f of folders) if (ids.some((id) => isInside(folders, f.id, id))) remove.add(f.id);
        nextFolders = folders.filter((f) => !remove.has(f.id));
        nextObjects = objects.filter((o) => !o.folderId || !remove.has(o.folderId));
      } else {
        // Innholdet flyttes til nærmeste mappe oppover som ikke slettes.
        const survivor = (id: string | null) => folderChain(folders, id).find((fid) => !remove.has(fid)) ?? null;
        nextFolders = folders.filter((f) => !remove.has(f.id)).map((f) => ({ ...f, parentId: survivor(f.parentId) }));
        nextObjects = objects.map((o) => (o.folderId && remove.has(o.folderId) ? { ...o, folderId: survivor(o.folderId) } : o));
      }

      commit(
        { folders: nextFolders, objects: nextObjects },
        {
          selectedIds: keepSelection(nextObjects),
          activeFolderId: activeFolderId && remove.has(activeFolderId) ? null : activeFolderId,
        },
      );
    },

    moveToFolder: ({ objectIds = [], folderIds = [] }, target) => {
      const { folders, objects } = get();
      assertFolder(folders, target);
      for (const id of folderIds) {
        if (target && isInside(folders, target, id)) {
          throw new Error("En mappe kan ikke flyttes inn i seg selv eller en av sine undermapper");
        }
      }
      const objSet = new Set(objectIds);
      const fldSet = new Set(folderIds);
      commit({
        objects: objects.map((o) => (objSet.has(o.id) ? { ...o, folderId: target } : o)),
        folders: folders.map((f) => (fldSet.has(f.id) ? { ...f, parentId: target } : f)),
      });
    },

    setCollapsed: (id, value) => set({ collapsed: { ...get().collapsed, [id]: value } }),
    setActiveFolder: (activeFolderId) => set({ activeFolderId }),

    applyScript: (ops, script) => {
      // Samme skript kjørt på nytt: fjern det forrige resultatet (i samme angre-steg), men
      // gjenbruk mappene, så plassering og ting brukeren selv har lagt i dem blir værende.
      const previous = script ? get().objects.filter((o) => o.script === script).length : 0;
      let objects = script ? get().objects.filter((o) => o.script !== script) : [...get().objects];
      let folders = [...get().folders];
      const oldFolders = script ? folders.filter((f) => f.script === script) : [];
      const reused = new Set<string>();
      const keys = new Map<string, string>();
      const result: ScriptResult = { replaced: previous, created: [], folders: [], updated: 0, deleted: 0, animated: 0, keys: {} };
      let clips = get().clips;

      // "@…" er nøkler fra skriptet; ellers id-er som må finnes i scenen.
      const resolve = (ref: string, kind: "objekt" | "mappe") => {
        if (ref.startsWith("@")) {
          const id = keys.get(ref);
          if (!id) throw new Error(`Ukjent nøkkel ${ref} i skriptet`);
          return id;
        }
        const exists = kind === "mappe" ? folders.some((f) => f.id === ref) : objects.some((o) => o.id === ref);
        if (!exists) throw new Error(`Fant ikke ${kind} ${ref}`);
        return ref;
      };
      const toProps = (props: Record<string, unknown>): Partial<SceneObject> & CurveInput & MeshInput => {
        const { folder, ...rest } = props;
        return {
          ...(rest as Partial<SceneObject> & CurveInput & MeshInput),
          ...(folder !== undefined ? { folderId: folder === null ? null : resolve(String(folder), "mappe") } : {}),
        };
      };

      for (const op of ops) {
        if (op.op === "folder") {
          const name = op.name?.trim() || "Ny mappe";
          const parentId = op.parent ? resolve(op.parent, "mappe") : null;
          const old = oldFolders.find((f) => !reused.has(f.id) && f.name === name && f.parentId === parentId);
          if (old) {
            reused.add(old.id);
            keys.set(op.key, old.id);
            if (op.model !== undefined) folders = folders.map((f) => (f === old ? { ...f, model: op.model } : f));
            continue;
          }
          const folder: Folder = {
            id: newId("fld"),
            name: uniqueName(name, siblings(folders, parentId)),
            parentId,
            visible: true,
            ...(op.model ? { model: true } : {}),
            ...(script ? { script } : {}),
          };
          folders.push(folder);
          keys.set(op.key, folder.id);
          result.folders.push(folder.id);
        } else if (op.op === "add") {
          const customMesh = op.type === "mesh" && op.props.vertices !== undefined;
          if (!customMesh && !(ADDABLE_SHAPES as readonly string[]).includes(op.type)) throw new Error(`Ukjent type «${op.type}» i skriptet`);
          const obj = makeObject(op.type, objects, { ...toProps(op.props), ...(script ? { script } : {}) });
          objects.push(obj);
          keys.set(op.key, obj.id);
          result.created.push(obj.id);
        } else if (op.op === "update") {
          const id = resolve(op.id, "objekt");
          const props = toProps(op.props);
          objects = objects.map((o) => (o.id === id ? withUpdate(o, props) : o));
          result.updated++;
        } else if (op.op === "delete") {
          const ids = new Set(op.ids.map((ref) => resolve(ref, "objekt")));
          objects = objects.filter((o) => !ids.has(o.id));
          result.deleted += ids.size;
        } else if (op.op === "animate" || op.op === "keyframes") {
          // Målet kan være et objekt eller en mappe.
          const target = op.target.startsWith("@") ? resolve(op.target, op.target.startsWith("@f") ? "mappe" : "objekt") : op.target;
          assertTarget(target, objects, folders);
          clips =
            op.op === "animate"
              ? presetInto(clips, target, op.preset, (op.options ?? {}) as PresetOptions)
              : keyframesInto(clips, op.clip, target, op.keys, { duration: op.duration, loop: op.loop });
          result.animated++;
        }
      }

      // Gamle skriptmapper som ikke ble brukt denne gangen fjernes – så sant de er tomme.
      let removedSome = true;
      while (removedSome) {
        removedSome = false;
        for (const f of oldFolders) {
          if (reused.has(f.id) || !folders.includes(f)) continue;
          const inUse = objects.some((o) => o.folderId === f.id) || folders.some((c) => c.parentId === f.id);
          if (!inUse) {
            folders = folders.filter((x) => x !== f);
            removedSome = true;
          }
        }
      }

      result.keys = Object.fromEntries(keys);
      const alive = new Set(objects.map((o) => o.id));
      commit({ objects, folders, clips }, { selectedIds: result.created.filter((id) => alive.has(id)) });
      return result;
    },

    addAnimation: (target, preset, options) => {
      assertTarget(target);
      const clips = presetInto(get().clips, target, preset, options);
      commit({ clips });
      return clips;
    },

    setKeyframes: (clip, target, keys, options) => {
      assertTarget(target);
      const clips = keyframesInto(get().clips, clip, target, keys, options);
      commit({ clips });
      return clips.find((c) => c.name === clip)!;
    },

    updateClip: (id, props) => {
      if (!get().clips.some((c) => c.id === id)) throw new Error(`Fant ikke klipp ${id}`);
      if (props.duration !== undefined && !(props.duration > 0)) throw new Error("duration må være over 0");
      commit({ clips: get().clips.map((c) => (c.id === id ? { ...c, ...props } : c)) });
    },

    setClipsLive: (clips) => set({ clips }),

    deleteClips: (ids) => {
      const remove = new Set(ids);
      commit({ clips: get().clips.filter((c) => !remove.has(c.id)) });
    },

    removeAnimations: (target) => {
      const clips = get()
        .clips.map((c) => ({ ...c, tracks: c.tracks.filter((t) => t.target !== target) }))
        .filter((c) => c.tracks.length);
      commit({ clips });
    },

    addNote: (props) => {
      const notes = get().notes;
      const note: Note = {
        id: newId("note"),
        number: notes.reduce((max, n) => Math.max(max, n.number), 0) + 1,
        status: "open",
        createdAt: new Date().toISOString(),
        replies: [],
        ...props,
      };
      commit({ notes: [...notes, note] });
      return note;
    },
    updateNote: (id, props) => {
      if (!get().notes.some((n) => n.id === id)) throw new Error(`Fant ikke kommentar ${id}`);
      commit({ notes: get().notes.map((n) => (n.id === id ? { ...n, ...props } : n)) });
    },
    replyToNote: (id, reply) => {
      if (!get().notes.some((n) => n.id === id)) throw new Error(`Fant ikke kommentar ${id}`);
      const at = new Date().toISOString();
      commit({ notes: get().notes.map((n) => (n.id === id ? { ...n, replies: [...n.replies, { ...reply, at }] } : n)) });
    },
    deleteNotes: (ids) => {
      const remove = new Set(ids);
      commit(
        { notes: get().notes.filter((n) => !remove.has(n.id)) },
        get().activeNoteId && remove.has(get().activeNoteId!) ? { activeNoteId: null, editingNoteId: null } : {},
      );
    },
    setTool: (tool) => set({ tool }),
    openNote: (id, editing = false) => set({ activeNoteId: id, editingNoteId: editing ? id : null }),
    setShowNotes: (showNotes) => set({ showNotes }),
    setShowResolvedNotes: (showResolvedNotes) => set({ showResolvedNotes }),

    setScene: ({ objects, folders, notes = [], clips = [] }) =>
      commit({ objects, folders, notes, clips }, { selectedIds: [], activeFolderId: null, activeNoteId: null }),
    clearScene: () =>
      commit({ objects: [], folders: [], notes: [], clips: [] }, { selectedIds: [], activeFolderId: null, activeNoteId: null }),

    select: (id, mode = "replace") => {
      if (!id) return set({ selectedIds: [] });
      const obj = get().objects.find((o) => o.id === id);
      if (!obj) return;
      const current = get().selectedIds.filter((s) => s !== id);
      if (mode === "toggle" && get().selectedIds.includes(id)) return set({ selectedIds: current });
      // Å velge et objekt gjør mappen dets til "aktiv", så nye former havner ved siden av.
      set({
        selectedIds: mode === "replace" ? [id] : [...current, id],
        ...(mode === "replace" ? { activeFolderId: obj.folderId } : {}),
      });
    },

    selectMany: (ids) => {
      const existing = new Set(get().objects.map((o) => o.id));
      set({ selectedIds: ids.filter((id) => existing.has(id)) });
    },

    selectFolder: (id) => {
      const { objects, folders } = get();
      set({
        selectedIds: objects.filter((o) => isInside(folders, o.folderId, id)).map((o) => o.id),
        activeFolderId: id,
      });
    },

    setTransformMode: (transformMode) => set({ transformMode }),
    toggleSnap: () => set({ snap: !get().snap }),
    toggleObjectSnap: () => set({ objectSnap: !get().objectSnap }),

    pushHistory: () => set({ past: [...get().past, snapshot()].slice(-HISTORY_LIMIT), future: [] }),

    undo: () => {
      const { past, future } = get();
      if (!past.length) return;
      set({ past: past.slice(0, -1), future: [snapshot(), ...future], ...restore(past[past.length - 1]) });
    },

    redo: () => {
      const { past, future } = get();
      if (!future.length) return;
      set({ past: [...past, snapshot()], future: future.slice(1), ...restore(future[0]) });
    },

    setBridgeStatus: (bridgeStatus) => set({ bridgeStatus }),
    setActivity: (activity) => set({ activity }),
    setFilePath: (filePath) => set({ filePath }),
    markSaved: () => set({ saved: snapshot() }),
  };
});
