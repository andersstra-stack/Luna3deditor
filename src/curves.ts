// Kurverør: et rør som følger en jevn kurve (Catmull-Rom) gjennom punktene, med radius per punkt.
// Geometrien bygges i meter fra punktene og normaliseres til enhetsboksen (som importerte modeller),
// så `scale` er størrelsen også her. Utad oppgis punktene i verdensrommet: `placeCurve` regner ut
// posisjon og størrelse, og lagrer punktene relativt til midten av røret.

import * as THREE from "three";
import type { Curve, SceneObject, Vec3 } from "./types";

/** Standardkurven fra verktøylinja: en grein som bøyer seg opp og smalner mot tuppen. */
const DEFAULT_POINTS: Vec3[] = [
  [-0.7, 0.12, 0],
  [-0.25, 0.3, 0],
  [0.2, 0.6, 0.05],
  [0.55, 1.1, 0],
];
const DEFAULT_RADIUS = [0.12, 0.09, 0.06, 0.03];

/** Segmenter rundt røret og langs hvert spenn mellom to punkter. */
export interface CurveDetail {
  radial: number;
  perSpan: number;
}
const SMOOTH: CurveDetail = { radial: 24, perSpan: 12 };
const MAX_STEPS = 600;

const radii = (c: Curve) => (Array.isArray(c.radius) ? c.radius : c.points.map(() => c.radius as number));

/** Sjekker punktene og radiusen fra MCP/Python/skjemaet. */
export function checkCurve(points: unknown, radius: unknown): Curve {
  if (!Array.isArray(points) || points.length < 2) throw new Error("points må være minst to punkter [x, y, z]");
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new Error(`Ugyldig punkt ${JSON.stringify(p)} – hvert punkt er [x, y, z] i meter`);
    }
  }
  const list = Array.isArray(radius) ? radius : [radius];
  if (Array.isArray(radius) && radius.length !== points.length) {
    throw new Error(`radius har ${radius.length} verdier, men det er ${points.length} punkter – gi ett tall eller én radius per punkt`);
  }
  if (!list.every((r) => typeof r === "number" && Number.isFinite(r) && r >= 0) || Math.max(...(list as number[])) <= 0) {
    throw new Error("radius må være tall ≥ 0 (minst én over 0)");
  }
  return { points: points as Vec3[], radius: radius as number | number[] };
}

/** Røret i meter (punktenes koordinater), lukket i begge ender så hull/CSG fungerer. */
export function buildCurveGeometry(curve: Curve, { radial, perSpan }: CurveDetail): THREE.BufferGeometry {
  const pts = curve.points.map((p) => new THREE.Vector3(...p));
  const n = pts.length;
  const path = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const r = radii(curve);
  const steps = Math.min(MAX_STEPS, Math.max(1, (n - 1) * perSpan));
  // getPoint(t) treffer punkt i ved t = i / (n - 1), så radiusen interpoleres på samme måte.
  const radiusAt = (t: number) => {
    const x = t * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    return r[i] + (r[i + 1] - r[i]) * (x - i);
  };

  const P: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) P.push(path.getPoint(i / steps));
  const T: THREE.Vector3[] = P.map((_, i) => P[Math.min(i + 1, steps)].clone().sub(P[Math.max(i - 1, 0)]));
  for (let i = 0; i <= steps; i++) {
    if (T[i].lengthSq() < 1e-12) T[i].copy(i > 0 ? T[i - 1] : new THREE.Vector3(0, 1, 0));
    T[i].normalize();
  }

  // Rammer uten vridning (parallell transport): normalen følger kurven uten å snurre rundt.
  const t0 = T[0];
  const ax = Math.abs(t0.x), ay = Math.abs(t0.y), az = Math.abs(t0.z);
  const helper = ax <= ay && ax <= az ? new THREE.Vector3(1, 0, 0) : ay <= az ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const N = new THREE.Vector3().crossVectors(t0, helper).normalize();
  const axis = new THREE.Vector3();

  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const ring = radial + 1;
  const ringDirs: THREE.Vector3[][] = [];

  for (let i = 0; i <= steps; i++) {
    if (i > 0) {
      axis.crossVectors(T[i - 1], T[i]);
      const len = axis.length();
      if (len > 1e-8) N.applyAxisAngle(axis.divideScalar(len), Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1)));
    }
    const B = new THREE.Vector3().crossVectors(T[i], N);
    const rad = radiusAt(i / steps);
    const dirs: THREE.Vector3[] = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const d = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      dirs.push(d);
      positions.push(P[i].x + d.x * rad, P[i].y + d.y * rad, P[i].z + d.z * rad);
      normals.push(d.x, d.y, d.z);
    }
    ringDirs.push(dirs);
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      // Retningen gir normaler som peker utover (B × T = N).
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  // Endelokk: flate skiver med egne hjørner (skarp kant).
  const cap = (i: number, sign: 1 | -1) => {
    const nrm = T[i].clone().multiplyScalar(sign);
    const rad = radiusAt(i / steps);
    const center = positions.length / 3;
    positions.push(P[i].x, P[i].y, P[i].z);
    normals.push(nrm.x, nrm.y, nrm.z);
    for (let j = 0; j <= radial; j++) {
      const d = ringDirs[i][j];
      positions.push(P[i].x + d.x * rad, P[i].y + d.y * rad, P[i].z + d.z * rad);
      normals.push(nrm.x, nrm.y, nrm.z);
    }
    for (let j = 0; j < radial; j++) {
      const v = center + 1 + j;
      if (sign > 0) index.push(center, v, v + 1);
      else index.push(center, v + 1, v);
    }
  };
  cap(0, -1);
  cap(steps, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(index);
  return geo;
}

export const curveKey = (c: Curve) => JSON.stringify([c.points, c.radius]);

// Boksen beregnes alltid fra den glatte varianten, så størrelsen ikke endrer seg med detaljnivået.
const boxCache = new Map<string, { center: Vec3; size: Vec3 }>();

/** Midten og størrelsen (meter) til røret slik punktene beskriver det. */
export function curveBox(curve: Curve): { center: Vec3; size: Vec3 } {
  const key = curveKey(curve);
  let box = boxCache.get(key);
  if (!box) {
    const geo = buildCurveGeometry(curve, SMOOTH);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    geo.dispose();
    const size = b.getSize(new THREE.Vector3()).toArray().map((v) => (v > 1e-5 ? v : 1)) as Vec3;
    box = { center: b.getCenter(new THREE.Vector3()).toArray() as Vec3, size };
    if (boxCache.size > 500) boxCache.delete(boxCache.keys().next().value!);
    boxCache.set(key, box);
  }
  return box;
}

/** Geometrien normalisert til enhetsboksen (det objektet tegnes med). */
export function normalizedCurveGeometry(curve: Curve, detail: CurveDetail): THREE.BufferGeometry {
  const { center, size } = curveBox(curve);
  const geo = buildCurveGeometry(curve, detail);
  return geo.translate(-center[0], -center[1], -center[2]).scale(1 / size[0], 1 / size[1], 1 / size[2]);
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Kurverør fra punkter i verdensrommet: posisjon = midten, størrelse = rørets mål, ingen rotasjon. */
export function placeCurve(points: unknown, radius: unknown): Pick<SceneObject, "curve" | "position" | "rotation" | "scale"> {
  const curve = checkCurve(points, radius);
  const { center, size } = curveBox(curve);
  return {
    curve: { points: curve.points.map((p) => p.map((v, a) => r4(v - center[a])) as Vec3), radius: curve.radius },
    position: center.map(r4) as Vec3,
    rotation: [0, 0, 0],
    scale: size.map(r4) as Vec3,
  };
}

function objectMatrix(o: Pick<SceneObject, "position" | "rotation" | "scale">) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rotation.map(THREE.MathUtils.degToRad) as Vec3), "XYZ"));
  return new THREE.Matrix4().compose(new THREE.Vector3(...o.position), q, new THREE.Vector3(...o.scale));
}

/** Punktene i verdensrommet (det MCP/Python ser), med flytting, rotasjon og størrelse tatt med. */
export function curveWorldPoints(o: SceneObject): Vec3[] {
  if (!o.curve) return [];
  const { center, size } = curveBox(o.curve);
  const m = objectMatrix(o);
  return o.curve.points.map(
    (p) => new THREE.Vector3(...p.map((v, a) => (v - center[a]) / size[a])).applyMatrix4(m).toArray().map(r4) as Vec3,
  );
}

/**
 * Ny radius på et eksisterende rør: punktene blir der de er i verden, og eventuell strekking (scale i forhold til
 * rørets egne mål) beholdes.
 */
export function reshapeCurve(o: SceneObject, radius: unknown): Pick<SceneObject, "curve" | "position" | "scale"> {
  if (!o.curve) throw new Error(`${o.name} er ikke et kurverør`);
  const old = curveBox(o.curve);
  const next = curveBox(checkCurve(o.curve.points, radius));
  const k = o.scale.map((s, a) => s / old.size[a]);
  const shift = new THREE.Vector3(...next.center.map((c, a) => (c - old.center[a]) * k[a]))
    .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rotation.map(THREE.MathUtils.degToRad) as Vec3), "XYZ")));
  return {
    curve: { points: o.curve.points.map((p) => p.map((v, a) => r4(v - next.center[a])) as Vec3), radius: radius as number | number[] },
    position: o.position.map((v, a) => r4(v + shift.getComponent(a))) as Vec3,
    scale: next.size.map((s, a) => r4(s * k[a])) as Vec3,
  };
}

/** Kurve-egenskapene til et nytt objekt: fra `points` (verdensrom), en kopi (`curve` finnes) eller standardgreina. */
export function newCurveProps(props: { points?: unknown; radius?: unknown; curve?: Curve; position?: Vec3 }) {
  if (props.points !== undefined) return placeCurve(props.points, props.radius ?? 0.1);
  if (props.curve) return {};
  const placed = placeCurve(DEFAULT_POINTS, props.radius ?? DEFAULT_RADIUS);
  // Fra verktøylinja: stå på bakken der kameraet ser.
  if (props.position) placed.position = [props.position[0], placed.scale[1] / 2, props.position[2]];
  return placed;
}

/** Største radius (det egenskapspanelet viser og endrer). */
export const maxRadius = (c: Curve) => Math.max(...radii(c));

/** Alle radiene ganget med samme faktor, så avsmalningen beholdes. */
export const scaledRadius = (c: Curve, factor: number): number | number[] =>
  Array.isArray(c.radius) ? c.radius.map((r) => r4(r * factor)) : r4(c.radius * factor);
