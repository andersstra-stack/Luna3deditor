import { create } from "zustand";
import { DEFAULT_COLORS, SHAPE_LABELS, type Folder, type SceneObject, type ShapeType, type TransformMode } from "./types";
import { folderChain, isInside } from "./folders";

const HISTORY_LIMIT = 100;

export type BridgeStatus = "disconnected" | "connected" | "busy";

/** Det som angres/gjøres om. */
export interface Snapshot {
  objects: SceneObject[];
  folders: Folder[];
}

export type NewObject = Partial<SceneObject> & { type: ShapeType };
export type FolderUpdate = Partial<Omit<Folder, "id">> & { id: string };

export interface EditorState extends Snapshot {
  selectedId: string | null;
  /** Mappen nye objekter og mapper havner i fra verktøylinja. */
  activeFolderId: string | null;
  /** Sammenslåtte mapper i scenelista (ren visning, ikke i historikken). */
  collapsed: Record<string, boolean>;
  transformMode: TransformMode;
  snap: boolean;
  past: Snapshot[];
  future: Snapshot[];
  bridgeStatus: BridgeStatus;
  /** Kort melding nederst i vinduet, f.eks. "Claude la til Kube". */
  activity: string | null;
  filePath: string | null;

  addObject: (type: ShapeType, props?: Partial<SceneObject>) => SceneObject;
  addObjects: (items: NewObject[]) => SceneObject[];
  updateObject: (id: string, props: Partial<SceneObject>) => void;
  updateObjects: (updates: (Partial<SceneObject> & { id: string })[]) => void;
  /** Oppdatering uten historikk – brukes mens gizmoen dras. */
  updateObjectLive: (id: string, props: Partial<SceneObject>) => void;
  deleteObjects: (ids: string[]) => void;
  duplicateObject: (id: string) => SceneObject | null;

  addFolders: (items: { name?: string; parentId?: string | null }[]) => Folder[];
  updateFolders: (updates: FolderUpdate[]) => void;
  /** Uten `deleteContents` flyttes innholdet opp til overordnet mappe. */
  deleteFolders: (ids: string[], deleteContents?: boolean) => void;
  /** Flytter objekter og/eller mapper inn i `target` (null = roten). */
  moveToFolder: (items: { objectIds?: string[]; folderIds?: string[] }, target: string | null) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  setActiveFolder: (id: string | null) => void;

  setScene: (scene: Snapshot) => void;
  clearScene: () => void;
  select: (id: string | null) => void;
  setTransformMode: (mode: TransformMode) => void;
  toggleSnap: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  setBridgeStatus: (status: BridgeStatus) => void;
  setActivity: (msg: string | null) => void;
  setFilePath: (path: string | null) => void;
}

let counter = 0;
export const newId = (prefix = "obj") => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function uniqueName(base: string, taken: { name: string }[]): string {
  const names = new Set(taken.map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function makeObject(type: ShapeType, existing: SceneObject[], props: Partial<SceneObject> = {}): SceneObject {
  const { id: _ignored, type: _type, ...rest } = props;
  return {
    id: newId(),
    name: uniqueName(props.name ?? SHAPE_LABELS[type], existing),
    // Plan ligger flatt på bakken, alt annet står oppå den.
    position: type === "plane" ? [0, 0, 0] : [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: DEFAULT_COLORS[existing.length % DEFAULT_COLORS.length],
    metalness: 0,
    roughness: 0.5,
    opacity: 1,
    visible: true,
    folderId: null,
    ...rest,
    type,
  };
}

function assertFolder(folders: Folder[], id: string | null | undefined) {
  if (id && !folders.some((f) => f.id === id)) throw new Error(`Fant ikke mappe ${id}`);
}

export const useEditor = create<EditorState>((set, get) => {
  /** Lagrer nåværende tilstand i angre-historikken før en endring. */
  const commit = (next: Partial<Snapshot>, extra: Partial<EditorState> = {}) => {
    const { past, objects, folders } = get();
    set({ past: [...past, { objects, folders }].slice(-HISTORY_LIMIT), future: [], ...next, ...extra });
  };

  /** Etter angre/gjør om kan utvalg og aktiv mappe peke på noe som ikke finnes lenger. */
  const restore = (snap: Snapshot): Partial<EditorState> => {
    const { selectedId, activeFolderId } = get();
    return {
      ...snap,
      selectedId: snap.objects.some((o) => o.id === selectedId) ? selectedId : null,
      activeFolderId: snap.folders.some((f) => f.id === activeFolderId) ? activeFolderId : null,
    };
  };

  return {
    objects: [],
    folders: [],
    selectedId: null,
    activeFolderId: null,
    collapsed: {},
    transformMode: "translate",
    snap: false,
    past: [],
    future: [],
    bridgeStatus: "disconnected",
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
      commit({ objects: all }, { selectedId: created[created.length - 1]?.id ?? get().selectedId });
      return created;
    },

    updateObject: (id, props) => get().updateObjects([{ ...props, id }]),

    updateObjects: (updates) => {
      const { objects, folders } = get();
      const missing = updates.filter((u) => !objects.some((o) => o.id === u.id));
      if (missing.length) throw new Error(`Fant ikke objekt(er): ${missing.map((m) => m.id).join(", ")}`);
      for (const u of updates) assertFolder(folders, u.folderId);
      const byId = new Map(updates.map((u) => [u.id, u]));
      commit({ objects: objects.map((o) => (byId.has(o.id) ? { ...o, ...byId.get(o.id), id: o.id, type: o.type } : o)) });
    },

    updateObjectLive: (id, props) =>
      set({ objects: get().objects.map((o) => (o.id === id ? { ...o, ...props, id } : o)) }),

    deleteObjects: (ids) => {
      const remove = new Set(ids);
      const { selectedId } = get();
      commit(
        { objects: get().objects.filter((o) => !remove.has(o.id)) },
        { selectedId: selectedId && remove.has(selectedId) ? null : selectedId },
      );
    },

    duplicateObject: (id) => {
      const src = get().objects.find((o) => o.id === id);
      if (!src) return null;
      const copy = makeObject(src.type, get().objects, {
        ...src,
        name: src.name.replace(/ \d+$/, ""),
        position: [src.position[0] + 1, src.position[1], src.position[2]],
      });
      commit({ objects: [...get().objects, copy] }, { selectedId: copy.id });
      return copy;
    },

    addFolders: (items) => {
      const all = [...get().folders];
      const created: Folder[] = [];
      for (const item of items) {
        assertFolder(all, item.parentId);
        const folder: Folder = {
          id: newId("fld"),
          name: uniqueName(item.name?.trim() || "Ny mappe", all),
          parentId: item.parentId ?? null,
          visible: true,
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
      const { folders, objects, selectedId, activeFolderId } = get();
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
          selectedId: nextObjects.some((o) => o.id === selectedId) ? selectedId : null,
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

    setScene: ({ objects, folders }) => commit({ objects, folders }, { selectedId: null, activeFolderId: null }),
    clearScene: () => commit({ objects: [], folders: [] }, { selectedId: null, activeFolderId: null }),

    select: (id) => {
      const obj = id ? get().objects.find((o) => o.id === id) : undefined;
      // Å velge et objekt gjør mappen dets til "aktiv", så nye former havner ved siden av.
      set(obj ? { selectedId: id, activeFolderId: obj.folderId } : { selectedId: null });
    },
    setTransformMode: (transformMode) => set({ transformMode }),
    toggleSnap: () => set({ snap: !get().snap }),

    pushHistory: () => {
      const { past, objects, folders } = get();
      set({ past: [...past, { objects, folders }].slice(-HISTORY_LIMIT), future: [] });
    },

    undo: () => {
      const { past, future, objects, folders } = get();
      if (!past.length) return;
      set({ past: past.slice(0, -1), future: [{ objects, folders }, ...future], ...restore(past[past.length - 1]) });
    },

    redo: () => {
      const { past, future, objects, folders } = get();
      if (!future.length) return;
      set({ past: [...past, { objects, folders }], future: future.slice(1), ...restore(future[0]) });
    },

    setBridgeStatus: (bridgeStatus) => set({ bridgeStatus }),
    setActivity: (activity) => set({ activity }),
    setFilePath: (filePath) => set({ filePath }),
  };
});
