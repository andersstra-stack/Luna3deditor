// Animasjon: klipp med nøkkelrammer på objekter og mapper (se AnimClip i types.ts). En nøkkelramme er en ENDRING fra
// hvileposisjonen, rundt målets pivot og i pivotens akser – et objekt dreier om sitt eget midtpunkt, en mappe om en
// markør-node som heter «pivot» (hengsel, aksel), ellers om midten under innholdet. Den samme utregningen brukes av
// avspillingen i 3D-visningen og av GLB-eksporten, så de viser alltid det samme.

import * as THREE from "three";
import { boxOf, objectMatrix, objectQuaternion } from "./bounds";
import { isInside } from "./folders";
import { isHelper, isNode, type AnimClip, type AnimKey, type Folder, type SceneObject, type Vec3 } from "./types";

const DEG = Math.PI / 180;

// ---------- Ferdige bevegelser ----------

export const PRESETS = ["spin", "sway", "bob", "open"] as const;
export type Preset = (typeof PRESETS)[number];
export type Axis = "x" | "y" | "z";

export const PRESET_LABELS: Record<Preset, string> = { spin: "Snurr", sway: "Svai", bob: "Hopp", open: "Åpne/lukke" };

/** Hva «amount» betyr for hver bevegelse, og standardverdiene. */
export const PRESET_DEFAULTS: Record<Preset, { axis: Axis; amount: number; duration: number; unit: string }> = {
  spin: { axis: "y", amount: 1, duration: 2, unit: "runder" },
  sway: { axis: "z", amount: 8, duration: 3, unit: "grader" },
  bob: { axis: "y", amount: 0.2, duration: 1, unit: "meter" },
  open: { axis: "y", amount: 90, duration: 1, unit: "grader" },
};

export interface PresetOptions {
  axis?: Axis;
  /** Runder (snurr), grader (svai, åpne) eller meter (hopp). Negativ = motsatt vei. */
  amount?: number;
  duration?: number;
  /** Navnet på klippet (standard: «Snurr», «Svai», «Hopp», «Åpne» + «Lukke»). */
  clip?: string;
}

export interface ClipPart {
  name: string;
  duration: number;
  loop: boolean;
  keys: AnimKey[];
}

const along = (axis: Axis, value: number): Vec3 => {
  const v: Vec3 = [0, 0, 0];
  v["xyz".indexOf(axis)] = value;
  return v;
};

/** Klippene en ferdig bevegelse gir (åpne/lukke gir to). */
export function presetClips(preset: Preset, options: PresetOptions = {}): ClipPart[] {
  const d = PRESET_DEFAULTS[preset];
  const axis = options.axis ?? d.axis;
  const amount = options.amount ?? d.amount;
  const duration = options.duration ?? d.duration;
  if (!(duration > 0)) throw new Error("duration må være over 0 sekunder");
  const rot = (v: number) => along(axis, v);
  switch (preset) {
    case "spin":
      return [
        {
          name: options.clip ?? "Snurr",
          duration,
          loop: true,
          keys: [
            { t: 0, rotation: rot(0) },
            { t: duration, rotation: rot(360 * amount) },
          ],
        },
      ];
    case "sway":
      return [
        {
          name: options.clip ?? "Svai",
          duration,
          loop: true,
          keys: [
            { t: 0, rotation: rot(0), ease: "smooth" },
            { t: duration / 4, rotation: rot(amount), ease: "smooth" },
            { t: (duration * 3) / 4, rotation: rot(-amount), ease: "smooth" },
            { t: duration, rotation: rot(0) },
          ],
        },
      ];
    case "bob":
      return [
        {
          name: options.clip ?? "Hopp",
          duration,
          loop: true,
          keys: [
            { t: 0, position: along(axis, 0), ease: "smooth" },
            { t: duration / 2, position: along(axis, amount), ease: "smooth" },
            { t: duration, position: along(axis, 0) },
          ],
        },
      ];
    case "open":
      return [
        {
          name: options.clip ?? "Åpne",
          duration,
          loop: false,
          keys: [
            { t: 0, rotation: rot(0), ease: "smooth" },
            { t: duration, rotation: rot(amount) },
          ],
        },
        {
          name: options.clip ? `${options.clip} (tilbake)` : "Lukke",
          duration,
          loop: false,
          keys: [
            { t: 0, rotation: rot(amount), ease: "smooth" },
            { t: duration, rotation: rot(0) },
          ],
        },
      ];
  }
}

/** Sjekker nøkkelrammer fra MCP/Python og sorterer dem på tid. */
export function checkKeys(keys: unknown): AnimKey[] {
  if (!Array.isArray(keys) || !keys.length) throw new Error("keys må være minst én nøkkelramme { t, position?, rotation?, scale? }");
  const vec = (v: unknown, name: string) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`${name} må være tre tall [x, y, z]`);
    }
    return v as Vec3;
  };
  return keys
    .map((k) => {
      const key = k as Record<string, unknown>;
      if (typeof key.t !== "number" || !(key.t >= 0)) throw new Error("Hver nøkkelramme trenger t (sekunder, ≥ 0)");
      if (key.ease !== undefined && key.ease !== "linear" && key.ease !== "smooth") throw new Error('ease må være "linear" eller "smooth"');
      const out: AnimKey = { t: key.t };
      const position = vec(key.position, "position");
      const rotation = vec(key.rotation, "rotation");
      const scale = vec(key.scale, "scale");
      if (position) out.position = position;
      if (rotation) out.rotation = rotation;
      if (scale) out.scale = scale;
      if (key.ease) out.ease = key.ease as AnimKey["ease"];
      return out;
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * Klippene med målets nøkkelrammer satt inn: i klippet med samme navn (målets gamle spor der byttes ut), ellers i et
 * nytt klipp. Varigheten blir den lengste av den gamle og den nye.
 */
export function withTrack(clips: AnimClip[], part: ClipPart, target: string, newId: () => string): AnimClip[] {
  const existing = clips.find((c) => c.name === part.name);
  if (!existing) return [...clips, { id: newId(), name: part.name, duration: part.duration, loop: part.loop, tracks: [{ target, keys: part.keys }] }];
  return clips.map((c) =>
    c === existing
      ? {
          ...c,
          duration: Math.max(c.duration, part.duration),
          loop: part.loop,
          tracks: [...c.tracks.filter((t) => t.target !== target), { target, keys: part.keys }],
        }
      : c,
  );
}

// ---------- Utregning ----------

type Channel = "position" | "rotation" | "scale";

/** Verdien av en kanal ved tid t (rammer uten kanalen hoppes over; før første og etter siste holdes verdien). */
function channelAt(keys: AnimKey[], ch: Channel, t: number, rest: Vec3): Vec3 {
  const ks = keys.filter((k) => k[ch]);
  if (!ks.length) return rest;
  if (t <= ks[0].t) return ks[0][ch]!;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last[ch]!;
  let i = 0;
  while (ks[i + 1].t < t) i++;
  const a = ks[i];
  const b = ks[i + 1];
  let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  if (a.ease === "smooth") f = f * f * (3 - 2 * f);
  return a[ch]!.map((v, j) => v + (b[ch]![j] - v) * f) as Vec3;
}

/** Endringen (i pivotens akser) ved tid t. */
export function deltaMatrix(keys: AnimKey[], t: number): THREE.Matrix4 {
  const p = channelAt(keys, "position", t, [0, 0, 0]);
  const r = channelAt(keys, "rotation", t, [0, 0, 0]);
  const s = channelAt(keys, "scale", t, [1, 1, 1]);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, "XYZ")),
    new THREE.Vector3(...s),
  );
}

/** «pivot» – også «pivot_02» osv., siden nodenavn nummereres for å være unike. */
export const isPivotNode = (o: SceneObject) => isNode(o.type) && /^pivot(_\d+)?$/i.test(o.name);

/** Pivot-rammen (plassering og retning, uten størrelse) for et objekt eller en mappe. */
export function pivotFrame(target: string, objects: SceneObject[], folders: Folder[]): THREE.Matrix4 | null {
  const obj = objects.find((o) => o.id === target);
  if (obj) return new THREE.Matrix4().compose(new THREE.Vector3(...obj.position), objectQuaternion(obj), new THREE.Vector3(1, 1, 1));
  if (!folders.some((f) => f.id === target)) return null;
  const inside = objects.filter((o) => o.folderId && isInside(folders, o.folderId, target));
  // Nærmeste «pivot»-node: rett i mappa før undermappene.
  const pivot = inside.find((o) => isPivotNode(o) && o.folderId === target) ?? inside.find(isPivotNode);
  if (pivot) return new THREE.Matrix4().compose(new THREE.Vector3(...pivot.position), objectQuaternion(pivot), new THREE.Vector3(1, 1, 1));
  const box = boxOf(inside.filter((o) => !isHelper(o.type) && !o.hole));
  if (box.isEmpty()) return new THREE.Matrix4();
  return new THREE.Matrix4().makeTranslation((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
}

/**
 * Regner ut bevegelsene i ett klipp. `motion(id, t)` er verdensendringen målet selv står for (F · D(t) · F⁻¹), og
 * `folderMotion`/`objectWorld` tar med alle mappene over. Resultatene huskes per tidspunkt.
 */
export function makeAnimator(clip: AnimClip, objects: SceneObject[], folders: Folder[]) {
  const tracks = new Map(clip.tracks.map((tr) => [tr.target, tr]));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const frames = new Map<string, THREE.Matrix4 | null>();
  const frameOf = (id: string) => {
    if (!frames.has(id)) frames.set(id, pivotFrame(id, objects, folders));
    return frames.get(id)!;
  };

  /** Beveger målet seg selv i klippet? */
  const animates = (id: string) => tracks.has(id) && !!frameOf(id);

  // Beveger mappa (eller en mappe over den) seg?
  const movingFolder = new Map<string, boolean>();
  const folderMoves = (id: string | null): boolean => {
    if (!id) return false;
    let v = movingFolder.get(id);
    if (v === undefined) {
      const f = folderById.get(id);
      v = !!f && (animates(id) || folderMoves(f.parentId));
      movingFolder.set(id, v);
    }
    return v;
  };

  let memoT = NaN;
  const memo = new Map<string, THREE.Matrix4>();
  const at = (t: number) => {
    if (t !== memoT) {
      memo.clear();
      memoT = t;
    }
  };

  const motion = (id: string, t: number): THREE.Matrix4 => {
    const F = frameOf(id);
    const tr = tracks.get(id);
    if (!F || !tr) return new THREE.Matrix4();
    return F.clone().multiply(deltaMatrix(tr.keys, t)).multiply(F.clone().invert());
  };

  /** Summen av bevegelsene til mappa og alle mappene over den (identitet hvis ingen beveger seg). */
  const folderMotion = (id: string | null, t: number): THREE.Matrix4 => {
    at(t);
    if (!id || !folderMoves(id)) return new THREE.Matrix4();
    const key = `f:${id}`;
    let m = memo.get(key);
    if (!m) {
      m = folderMotion(folderById.get(id)?.parentId ?? null, t).multiply(motion(id, t));
      memo.set(key, m);
    }
    return m.clone();
  };

  /** Objektets verdensmatrise ved tid t (hvile + egne og mappenes bevegelser). */
  const objectWorld = (o: SceneObject, t: number): THREE.Matrix4 =>
    folderMotion(o.folderId, t).multiply(motion(o.id, t)).multiply(objectMatrix(o));

  /** Objekter som beveger seg i klippet (selv eller via en mappe). */
  const moving = objects.filter((o) => animates(o.id) || folderMoves(o.folderId));

  /** Verdensmatrisene til alt som beveger seg, ved tid t. */
  const poseAt = (t: number) => new Map(moving.map((o) => [o.id, objectWorld(o, t)]));

  return { clip, animates, folderMoves, motion, folderMotion, objectWorld, poseAt, moving, objectById };
}
