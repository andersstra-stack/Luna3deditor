// Animasjon fra en annen rigg (Mixamo-FBX, GLB) overført til beina i Luna – «retargeting». Hvert Luna-bein som har en
// partner i kilden (samme navn uten «mixamorig:», eller et kjent alias), får kildebeinets rotasjon i verdensrommet,
// målt fra hvilen: R(t) = Q_kilde(t) · Q_kilde,hvile⁻¹ · A⁻¹ · Q_luna,hvile. A dreier kildebeinets retning i hvile over på
// Luna-beinets, så en Mixamo-rigg i T-positur passer på en figur i A-positur. Hoftenes forflytning skaleres med
// høydeforskjellen. Resultatet blir vanlige nøkkelrammer (endring i beinets akser), samme som set_keyframes.
// Bare three og typer importeres, så modulen kan kjøres rett i Node (testing mot ekte filer).

import * as THREE from "three";
import type { AnimKey, AnimTrack, SceneObject, Vec3 } from "./types";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

export interface RetargetOptions {
  /** Navnet på klippet (standard: kildens navn). */
  name?: string;
  /** Bilder per sekund i nøkkelrammene (standard 30). */
  fps?: number;
  /** Fjern forflytningen framover/sidelengs (gange på stedet, som «In Place» hos Mixamo). Høyden beholdes. */
  inPlace?: boolean;
  loop?: boolean;
}

/** Nøkler som ligger så nær den rette linja mellom naboene fjernes (Luna interpolerer lineært mellom nøklene). */
const ROTATION_TOLERANCE = 0.3; // grader
const POSITION_TOLERANCE = 0.001; // meter

/**
 * Færre nøkler med samme bevegelse: går fram fra siste beholdte nøkkel og strekker linja så langt alle nøklene imellom
 * ligger innenfor toleransen. Første og siste nøkkel beholdes alltid.
 */
export function reduceKeys(keys: AnimKey[]): AnimKey[] {
  if (keys.length < 3) return keys;
  const fits = (a: AnimKey, b: AnimKey, k: AnimKey) => {
    const f = (k.t - a.t) / (b.t - a.t || 1);
    const near = (x?: Vec3, y?: Vec3, z?: Vec3, tol = 0) => !x || !y || !z || z.every((v, i) => Math.abs(x[i] + (y[i] - x[i]) * f - v) <= tol);
    return near(a.rotation, b.rotation, k.rotation, ROTATION_TOLERANCE) && near(a.position, b.position, k.position, POSITION_TOLERANCE);
  };
  const out = [keys[0]];
  let anchor = 0;
  for (let j = 2; j < keys.length; j++) {
    let ok = true;
    for (let k = anchor + 1; k < j && ok; k++) ok = fits(keys[anchor], keys[j], keys[k]);
    if (!ok) {
      anchor = j - 1;
      out.push(keys[anchor]);
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

export interface RetargetResult {
  name: string;
  duration: number;
  loop: boolean;
  tracks: AnimTrack[];
  /** Luna-bein → kildebein. */
  mapped: { bone: string; source: string }[];
  /** Luna-bein uten partner (står stille i forhold til forelderen). */
  unmapped: string[];
  /** Nøkler før og etter reduksjonen. */
  sampled: number;
  keys: number;
}

/** Navn uten rigg-prefiks («mixamorig:LeftArm», «mixamorig1LeftArm» → «leftarm»). */
export function boneKey(name: string): string {
  return name
    .replace(/^.*:/, "")
    .replace(/^mixamorig\d*/i, "")
    .replace(/[\s._-]/g, "")
    .toLowerCase();
}

/** Andre navn som brukes på de samme beina (Luna-eksempler, Blender/Rigify-aktige) → Mixamo-navnet. */
const ALIASES: Record<string, string> = {
  pelvis: "hips",
  chest: "spine2",
  upperchest: "spine2",
  upperarml: "leftarm",
  upperarmr: "rightarm",
  lowerarml: "leftforearm",
  lowerarmr: "rightforearm",
  forearml: "leftforearm",
  forearmr: "rightforearm",
  handl: "lefthand",
  handr: "righthand",
  shoulderl: "leftshoulder",
  shoulderr: "rightshoulder",
  upperlegl: "leftupleg",
  upperlegr: "rightupleg",
  thighl: "leftupleg",
  thighr: "rightupleg",
  lowerlegl: "leftleg",
  lowerlegr: "rightleg",
  shinl: "leftleg",
  shinr: "rightleg",
  footl: "leftfoot",
  footr: "rightfoot",
  toel: "lefttoebase",
  toer: "righttoebase",
};
const lunaKey = (name: string) => {
  const k = boneKey(name);
  return ALIASES[k] ?? k;
};

const quatOf = (o: Pick<SceneObject, "rotation">) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, "XYZ"));

/** Det lengste klippet med spor (Mixamo har også et tomt «Take 001»). */
function pickClip(source: THREE.Object3D): THREE.AnimationClip {
  const clips = source.animations.filter((c) => c.tracks.length && c.duration > 0);
  if (!clips.length) throw new Error("Fila har ingen animasjon");
  return clips.sort((a, b) => b.tracks.length - a.tracks.length || b.duration - a.duration)[0];
}

/** Euler-vinkler (grader) for q, lagt så nær forrige ramme som mulig (begge XYZ-løsningene og ±360). */
function eulerNear(q: THREE.Quaternion, prev: Vec3): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const [x, y, z] = [e.x / DEG, e.y / DEG, e.z / DEG];
  const unwrap = (a: number[]) =>
    a.map((deg, i) => {
      while (deg - prev[i] > 180) deg -= 360;
      while (deg - prev[i] < -180) deg += 360;
      return deg;
    });
  const options = [unwrap([x, y, z]), unwrap([x + 180, 180 - y, z + 180])];
  const dist = (a: number[]) => a.reduce((s, v, i) => s + Math.abs(v - prev[i]), 0);
  const best = dist(options[0]) <= dist(options[1]) ? options[0] : options[1];
  return best.map((v) => Math.round(v * 100) / 100) as Vec3;
}

/**
 * Overfører animasjonen i `source` (lastet med FBXLoader/GLTFLoader, med `animations`) til `bones` (Luna-bein, i
 * verdensrom). Bein uten partner får ingen spor og følger bare forelderen.
 */
export function retargetAnimation(source: THREE.Object3D, bones: SceneObject[], options: RetargetOptions = {}): RetargetResult {
  const clip = pickClip(source);
  const fps = options.fps ?? 30;

  // Kildebeina etter nøkkel – det første med navnet (FBXLoader lager av og til en tom kopi som barn).
  const sourceBones = new Map<string, THREE.Object3D>();
  source.traverse((o) => {
    if (((o as THREE.Bone).isBone || o.type === "Bone") && !sourceBones.has(boneKey(o.name))) sourceBones.set(boneKey(o.name), o);
  });
  if (!sourceBones.size) throw new Error("Fila har ikke noe skjelett");

  // Luna-beina med foreldre før barn.
  const byId = new Map(bones.map((b) => [b.id, b]));
  const ordered: SceneObject[] = [];
  const done = new Set<string>();
  const visit = (b: SceneObject, depth = 0) => {
    if (done.has(b.id) || depth > bones.length) return;
    const p = b.parentId ? byId.get(b.parentId) : undefined;
    if (p) visit(p, depth + 1);
    if (!done.has(b.id)) {
      done.add(b.id);
      ordered.push(b);
    }
  };
  bones.forEach((b) => visit(b));

  const pair = new Map<string, THREE.Object3D>();
  for (const b of ordered) {
    const s = sourceBones.get(lunaKey(b.name));
    if (s) pair.set(b.id, s);
  }
  if (!pair.size) {
    throw new Error(
      `Ingen bein har samme navn som i fila. Luna-beina må hete som kilden (f.eks. ${[...sourceBones.keys()].slice(0, 4).join(", ")} …) – add_humanoid_skeleton lager Mixamo-navn.`,
    );
  }

  // Hvilen: kildens hvile før avspilling, Luna-beinas hvile fra dataene.
  source.updateMatrixWorld(true);
  const srcRestQ = new Map<string, THREE.Quaternion>();
  const srcRestP = new Map<string, THREE.Vector3>();
  for (const [id, s] of pair) {
    srcRestQ.set(id, s.getWorldQuaternion(new THREE.Quaternion()));
    srcRestP.set(id, s.getWorldPosition(new THREE.Vector3()));
  }
  const restQ = new Map(ordered.map((b) => [b.id, quatOf(b)]));
  // Kildebeinets retning i hvile, målt som Luna-beinets (fra leddet mot tuppen): mot kilden til Luna-barnet, ellers
  // mot snittet av kildebarna (hånden: mot fingrene), ellers langs beinets egen Y-akse.
  const childrenOf = new Map<string, SceneObject[]>();
  for (const b of ordered) if (b.parentId && byId.has(b.parentId)) childrenOf.set(b.parentId, [...(childrenOf.get(b.parentId) ?? []), b]);
  const sourceDir = (id: string): THREE.Vector3 => {
    const head = srcRestP.get(id)!;
    const child = (childrenOf.get(id) ?? []).find((c) => pair.has(c.id));
    if (child) {
      const d = srcRestP.get(child.id)!.clone().sub(head);
      if (d.lengthSq() > 1e-12) return d.normalize();
    }
    const tips = pair
      .get(id)!
      .children.filter((c) => (c as THREE.Bone).isBone || c.type === "Bone")
      .map((c) => c.getWorldPosition(new THREE.Vector3()))
      .filter((p) => p.distanceToSquared(head) > 1e-12);
    if (tips.length) return tips.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(tips.length).sub(head).normalize();
    return UP.clone().applyQuaternion(srcRestQ.get(id)!);
  };
  // A⁻¹ · Q_luna: Luna-beinet dreid så det peker dit kildebeinet peker i hvile.
  const alignedRest = new Map<string, THREE.Quaternion>();
  for (const [id] of pair) {
    const dSrc = sourceDir(id);
    const dLuna = UP.clone().applyQuaternion(restQ.get(id)!);
    const A = new THREE.Quaternion().setFromUnitVectors(dSrc, dLuna);
    alignedRest.set(id, A.invert().multiply(restQ.get(id)!));
  }

  // Rotbeinet (det øverste med partner, typisk Hips) flytter seg; skalert med høyden over det laveste beinet.
  const root = ordered.find((b) => pair.has(b.id) && !(b.parentId && byId.has(b.parentId)));
  let scale = 1;
  if (root) {
    let srcMin = Infinity;
    for (const s of sourceBones.values()) srcMin = Math.min(srcMin, s.getWorldPosition(new THREE.Vector3()).y);
    const lunaMin = Math.min(...bones.map((b) => b.position[1]));
    const srcH = srcRestP.get(root.id)!.y - srcMin;
    const lunaH = root.position[1] - lunaMin;
    scale = srcH > 1e-6 && lunaH > 1e-6 ? lunaH / srcH : 1;
  }

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.play();
  const steps = Math.max(1, Math.round(clip.duration * fps));
  const keys = new Map<string, AnimKey[]>(ordered.filter((b) => pair.has(b.id)).map((b) => [b.id, []]));
  const prev = new Map<string, Vec3>();

  for (let i = 0; i <= steps; i++) {
    const t = Math.min(clip.duration, i / fps);
    mixer.setTime(t);
    source.updateMatrixWorld(true);
    // Hvert beins rotasjon i verdensrommet ved t (foreldre først).
    const world = new Map<string, THREE.Quaternion>();
    for (const b of ordered) {
      const parent = b.parentId ? byId.get(b.parentId) : undefined;
      // Bevegelsen beinet arver: forelderens rotasjon nå · forelderens hvile⁻¹.
      const inherited = parent ? world.get(parent.id)!.clone().multiply(restQ.get(parent.id)!.clone().invert()) : new THREE.Quaternion();
      const s = pair.get(b.id);
      const R = s
        ? s.getWorldQuaternion(new THREE.Quaternion()).multiply(srcRestQ.get(b.id)!.clone().invert()).multiply(alignedRest.get(b.id)!)
        : inherited.clone().multiply(restQ.get(b.id)!);
      world.set(b.id, R);
      if (!s) continue;
      // Endringen i beinets egne akser: D = Q_hvile⁻¹ · arvet⁻¹ · R.
      const D = restQ.get(b.id)!.clone().invert().multiply(inherited.clone().invert()).multiply(R);
      const rotation = eulerNear(D, prev.get(b.id) ?? [0, 0, 0]);
      prev.set(b.id, rotation);
      const key: AnimKey = { t: Math.round(t * 1000) / 1000, rotation };
      if (b === root) {
        const delta = s.getWorldPosition(new THREE.Vector3()).sub(srcRestP.get(b.id)!).multiplyScalar(scale);
        if (options.inPlace) delta.x = delta.z = 0;
        key.position = delta
          .applyQuaternion(restQ.get(b.id)!.clone().invert())
          .toArray()
          .map((v) => Math.round(v * 1e4) / 1e4) as Vec3;
      }
      keys.get(b.id)!.push(key);
    }
  }
  mixer.stopAllAction();

  const mapped = [...pair].map(([id, s]) => ({ bone: byId.get(id)!.name, source: s.name }));
  const tracks = [...keys].map(([target, ks]) => ({ target, keys: reduceKeys(ks) }));
  return {
    name: options.name ?? clip.name,
    duration: Math.round(clip.duration * 1000) / 1000,
    loop: options.loop ?? true,
    tracks,
    sampled: [...keys.values()].reduce((n, ks) => n + ks.length, 0),
    keys: tracks.reduce((n, t) => n + t.keys.length, 0),
    mapped,
    unmapped: ordered.filter((b) => !pair.has(b.id)).map((b) => b.name),
  };
}
