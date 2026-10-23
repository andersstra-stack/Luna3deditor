import { create } from "zustand";
import { DEFAULT_COLORS, SHAPE_LABELS, type SceneObject, type ShapeType, type TransformMode } from "./types";

const HISTORY_LIMIT = 100;

export type BridgeStatus = "disconnected" | "connected";

export interface EditorState {
  objects: SceneObject[];
  selectedId: string | null;
  transformMode: TransformMode;
  snap: boolean;
  past: SceneObject[][];
  future: SceneObject[][];
  bridgeStatus: BridgeStatus;
  /** Kort melding nederst i vinduet, f.eks. "Claude la til Kube". */
  activity: string | null;
  filePath: string | null;

  addObject: (type: ShapeType, props?: Partial<SceneObject>) => SceneObject;
  addObjects: (items: (Partial<SceneObject> & { type: ShapeType })[]) => SceneObject[];
  updateObject: (id: string, props: Partial<SceneObject>) => void;
  updateObjects: (updates: (Partial<SceneObject> & { id: string })[]) => void;
  /** Oppdatering uten historikk – brukes mens gizmoen dras. */
  updateObjectLive: (id: string, props: Partial<SceneObject>) => void;
  deleteObjects: (ids: string[]) => void;
  duplicateObject: (id: string) => SceneObject | null;
  setObjects: (objects: SceneObject[]) => void;
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
export const newId = () => `obj_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function uniqueName(base: string, objects: SceneObject[]): string {
  const names = new Set(objects.map((o) => o.name));
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
    ...rest,
    type,
  };
}

export const useEditor = create<EditorState>((set, get) => {
  /** Lagrer nåværende tilstand i angre-historikken før en endring. */
  const commit = (objects: SceneObject[], extra: Partial<EditorState> = {}) => {
    const { past, objects: current } = get();
    set({ past: [...past, current].slice(-HISTORY_LIMIT), future: [], objects, ...extra });
  };

  return {
    objects: [],
    selectedId: null,
    transformMode: "translate",
    snap: false,
    past: [],
    future: [],
    bridgeStatus: "disconnected",
    activity: null,
    filePath: null,

    addObject: (type, props) => get().addObjects([{ ...props, type }])[0],

    addObjects: (items) => {
      const all = [...get().objects];
      const created: SceneObject[] = [];
      for (const item of items) {
        const obj = makeObject(item.type, all, item);
        all.push(obj);
        created.push(obj);
      }
      commit(all, { selectedId: created[created.length - 1]?.id ?? get().selectedId });
      return created;
    },

    updateObject: (id, props) => get().updateObjects([{ ...props, id }]),

    updateObjects: (updates) => {
      const byId = new Map(updates.map((u) => [u.id, u]));
      const missing = updates.filter((u) => !get().objects.some((o) => o.id === u.id));
      if (missing.length) throw new Error(`Fant ikke objekt(er): ${missing.map((m) => m.id).join(", ")}`);
      commit(get().objects.map((o) => (byId.has(o.id) ? { ...o, ...byId.get(o.id), id: o.id } : o)));
    },

    updateObjectLive: (id, props) =>
      set({ objects: get().objects.map((o) => (o.id === id ? { ...o, ...props, id } : o)) }),

    deleteObjects: (ids) => {
      const remove = new Set(ids);
      const { selectedId } = get();
      commit(
        get().objects.filter((o) => !remove.has(o.id)),
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
      commit([...get().objects, copy], { selectedId: copy.id });
      return copy;
    },

    setObjects: (objects) => commit(objects, { selectedId: null }),
    clearScene: () => commit([], { selectedId: null }),

    select: (id) => set({ selectedId: id }),
    setTransformMode: (transformMode) => set({ transformMode }),
    toggleSnap: () => set({ snap: !get().snap }),

    pushHistory: () => {
      const { past, objects } = get();
      set({ past: [...past, objects].slice(-HISTORY_LIMIT), future: [] });
    },

    undo: () => {
      const { past, future, objects, selectedId } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [objects, ...future],
        objects: prev,
        selectedId: prev.some((o) => o.id === selectedId) ? selectedId : null,
      });
    },

    redo: () => {
      const { past, future, objects, selectedId } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        past: [...past, objects],
        future: future.slice(1),
        objects: next,
        selectedId: next.some((o) => o.id === selectedId) ? selectedId : null,
      });
    },

    setBridgeStatus: (bridgeStatus) => set({ bridgeStatus }),
    setActivity: (activity) => set({ activity }),
    setFilePath: (filePath) => set({ filePath }),
  };
});
