// Automatisk menneskeskjelett: ut fra hjørnene i en figur som står i T- eller A-positur (Y opp, ansiktet mot +Z)
// plasseres et skjelett med Mixamo-navnene (Hips, Spine … LeftArm, LeftForeArm …). Da kan Mixamo-animasjoner legges
// rett på (retarget.ts), og Unity kjenner igjen skjelettet som Humanoid. Høydene er Mixamo-riggens proporsjoner; armene
// finnes med en linje gjennom midten av snitt langs armen, beina og ryggen med snitt gjennom modellen.

import * as THREE from "three";
import { getMeshAsset } from "./meshes";
import { objectMatrix } from "./bounds";
import type { SceneObject, Vec3 } from "./types";

/** Et bein i malen: navn, rot, tupp og forelder (navn). */
export interface HumanoidBone {
  name: string;
  head: Vec3;
  tail: Vec3;
  parent: string | null;
}

/** Høyder som andel av figurens høyde (Mixamo-riggen: 182 cm til toppen av hodet). */
const H = {
  hips: 0.573,
  spine: 0.629,
  spine1: 0.684,
  spine2: 0.734,
  neck: 0.826,
  head: 0.879,
  shoulder: 0.795,
  upLeg: 0.536,
  knee: 0.292,
  ankle: 0.048,
};
/** Avstand fra midten til skulderleddet og hofteleddet, og håndens lengde (andel av høyden). */
const ARM_X = 0.0835;
const CLAVICLE_X = 0.025;
const HAND = 0.105;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const vec = (v: THREE.Vector3): Vec3 => [r4(v.x), r4(v.y), r4(v.z)];

/** Hjørnene til modellene i verdensrommet. */
function worldPoints(meshes: SceneObject[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const o of meshes) {
    const asset = o.type === "mesh" && o.meshId ? getMeshAsset(o.meshId) : undefined;
    if (!asset) throw new Error(`${o.name} er ikke en modell (type mesh)`);
    const m = objectMatrix(o);
    const p = asset.positions;
    for (let i = 0; i < p.length; i += 3) out.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]).applyMatrix4(m));
  }
  if (out.length < 100) throw new Error("For få hjørner til å finne et skjelett");
  return out;
}

/** Midten (mellom ytterkantene) av punktene som passer, eller null. */
function middle(points: THREE.Vector3[], keep: (p: THREE.Vector3) => boolean): THREE.Vector3 | null {
  const box = new THREE.Box3();
  let n = 0;
  for (const p of points) {
    if (!keep(p)) continue;
    box.expandByPoint(p);
    n++;
  }
  return n >= 3 ? box.getCenter(new THREE.Vector3()) : null;
}

/** Skjelettet for figuren (verdensrom). Kaster hvis armene ikke finnes (figuren må stå i T- eller A-positur). */
export function humanoidSkeleton(meshes: SceneObject[]): HumanoidBone[] {
  const pts = worldPoints(meshes);
  const box = new THREE.Box3().setFromPoints(pts);
  const y0 = box.min.y;
  const height = box.max.y - y0;
  const cx = (box.min.x + box.max.x) / 2;
  const at = (f: number) => y0 + f * height;
  const band = 0.02 * height;

  // Ryggen: midten mellom forside og bakside i en smal stripe midt på figuren.
  const spineZ = (f: number) => middle(pts, (p) => Math.abs(p.x - cx) < 0.05 * height && Math.abs(p.y - at(f)) < band)?.z ?? (box.min.z + box.max.z) / 2;
  const center = (f: number) => new THREE.Vector3(cx, at(f), spineZ(f));

  const bones: HumanoidBone[] = [];
  const add = (name: string, head: THREE.Vector3, tail: THREE.Vector3, parent: string | null) =>
    bones.push({ name, head: vec(head), tail: vec(tail), parent });

  const hips = center(H.hips);
  const spine = center(H.spine);
  const spine1 = center(H.spine1);
  const spine2 = center(H.spine2);
  const neck = center(H.neck);
  const head = center(H.head);
  const top = new THREE.Vector3(head.x, box.max.y, head.z);
  add("Hips", hips, spine, null);
  add("Spine", spine, spine1, "Hips");
  add("Spine1", spine1, spine2, "Spine");
  add("Spine2", spine2, neck, "Spine1");
  add("Neck", neck, head, "Spine2");
  add("Head", head, top, "Neck");

  // Beina: midten av snittet gjennom låret, kneet og leggen. Gjort symmetrisk (snitt av sidene), så et hylster eller en
  // lomme på det ene låret ikke drar leddet skjevt.
  const legSide = (s: number) => {
    const leg = (f: number) =>
      middle(pts, (p) => s * (p.x - cx) > 0.005 * height && s * (p.x - cx) < 0.15 * height && Math.abs(p.y - at(f)) < band * 0.75);
    const thigh = leg(0.45) ?? new THREE.Vector3(cx + s * 0.045 * height, at(0.45), hips.z);
    const knee = leg(H.knee) ?? new THREE.Vector3(thigh.x, at(H.knee), thigh.z);
    const shin = leg(0.09) ?? new THREE.Vector3(knee.x, at(0.09), knee.z);
    const foot = pts.filter((p) => s * (p.x - cx) > 0 && s * (p.x - cx) < 0.15 * height && p.y < at(0.04));
    const footBox = new THREE.Box3().setFromPoints(foot.length ? foot : [shin]);
    return { thigh, knee, shin, toeMin: footBox.min.z, toeMax: footBox.max.z };
  };
  const L = legSide(1);
  const R = legSide(-1);
  const avg = (a: number, b: number) => (a + b) / 2;
  const legX = { thigh: avg(L.thigh.x - cx, cx - R.thigh.x), knee: avg(L.knee.x - cx, cx - R.knee.x), shin: avg(L.shin.x - cx, cx - R.shin.x) };
  const legZ = { knee: avg(L.knee.z, R.knee.z), shin: avg(L.shin.z, R.shin.z), toeMin: avg(L.toeMin, R.toeMin), toeMax: avg(L.toeMax, R.toeMax) };

  // Armene: midten av tverrsnitt langs X (bare det som er utenfor kroppen, over hofta). Skulderplater og hansker gjør
  // en hovedakse gjennom alle hjørnene skjev; midtene av snittene følger selve armen.
  const armSide = (s: number) => {
    const arm = pts.filter((p) => s * (p.x - cx) > 0.17 * height && p.y > at(0.5));
    if (arm.length < 30) throw new Error(`Fant ikke ${s > 0 ? "venstre" : "høyre"} arm – figuren må stå i T- eller A-positur`);
    const reach = Math.max(...arm.map((p) => s * (p.x - cx)));
    const samples: THREE.Vector3[] = [];
    const slices = 10;
    for (let i = 0; i < slices; i++) {
      // Fra 0.2·høyde ut til der hånden begynner.
      const x = 0.2 * height + ((reach - HAND * height - 0.2 * height) * (i + 0.5)) / slices;
      const c = middle(arm, (p) => Math.abs(s * (p.x - cx) - x) < 0.01 * height);
      if (c) samples.push(c);
    }
    if (samples.length < 3) throw new Error("Fant ikke armens akse – figuren må stå i T- eller A-positur");
    // Rett linje y(x), z(x) gjennom midtene (minste kvadraters metode).
    const n = samples.length;
    const mx = samples.reduce((a, p) => a + p.x, 0) / n;
    const my = samples.reduce((a, p) => a + p.y, 0) / n;
    const mz = samples.reduce((a, p) => a + p.z, 0) / n;
    const sxx = samples.reduce((a, p) => a + (p.x - mx) ** 2, 0) || 1e-9;
    const by = samples.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
    const bz = samples.reduce((a, p) => a + (p.x - mx) * (p.z - mz), 0) / sxx;
    const on = (x: number) => new THREE.Vector3(x, my + by * (x - mx), mz + bz * (x - mx));
    const dir = new THREE.Vector3(s, s * by, s * bz).normalize();
    const tip = on(cx + s * reach);
    return { on, dir, tip };
  };

  for (const [side, s] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const { on, dir, tip } = armSide(s);
    // Skulderleddet: armlinjens høyde der den krysser x = ±ARM_X·høyde, midt i overkroppen i dybden.
    const armHead = on(cx + s * ARM_X * height).setZ(spineZ(H.shoulder));
    const wrist = tip.clone().addScaledVector(dir, -HAND * height);
    const elbow = armHead.clone().lerp(wrist, 0.5);
    const clavicle = new THREE.Vector3(cx + s * CLAVICLE_X * height, armHead.y + 0.003 * height, armHead.z);
    add(`${side}Shoulder`, clavicle, armHead, "Spine2");
    add(`${side}Arm`, armHead, elbow, `${side}Shoulder`);
    add(`${side}ForeArm`, elbow, wrist, `${side}Arm`);
    add(`${side}Hand`, wrist, tip, `${side}ForeArm`);

    const upLeg = new THREE.Vector3(cx + s * legX.thigh, at(H.upLeg), hips.z);
    const knee = new THREE.Vector3(cx + s * legX.knee, at(H.knee), legZ.knee);
    const ankle = new THREE.Vector3(cx + s * legX.shin, at(H.ankle), legZ.shin);
    // Foten: tærne er det som stikker lengst fram nederst; tåleddet 60 % av veien fra hælen.
    const toeEnd = new THREE.Vector3(ankle.x, y0 + 0.005 * height, legZ.toeMax);
    const toeBase = new THREE.Vector3(ankle.x, y0 + 0.01 * height, legZ.toeMin + 0.6 * (legZ.toeMax - legZ.toeMin));
    add(`${side}UpLeg`, upLeg, knee, "Hips");
    add(`${side}Leg`, knee, ankle, `${side}UpLeg`);
    add(`${side}Foot`, ankle, toeBase, `${side}Leg`);
    add(`${side}ToeBase`, toeBase, toeEnd, `${side}Foot`);
  }
  return bones;
}
