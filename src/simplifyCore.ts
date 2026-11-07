// Forenkling av en modell (færre trekanter) med meshoptimizer. Ren matte uten three og uten scenen, så den kan
// kjøres og testes direkte i Node: `meshSimplify.ts` kobler den til registeret og angre-historikken.
//
// Hjørnene sveises først (like posisjon/UV/farge = samme hjørne), ellers blir simplifieren «sittende fast» på
// fasetterte og uindekserte modeller. Posisjonene ganges med objektets størrelse, så feilen måles i ekte meter
// også på flate, strukket modeller. UV, hjørnefarger og normaler regnes med i feilen og flyttes sammen med hjørnene
// (`simplifyWithUpdate`), og sømmer i UV-ene holdes. Resultatet normaliseres til enhetsboksen igjen.

import { MeshoptSimplifier } from "meshoptimizer";
import type { MeshAsset, Vec3 } from "./types";

export interface SimplifyTarget {
  /** Andel av trekantene som skal bli igjen (0–1). */
  ratio?: number;
  /** Antall trekanter som skal bli igjen (brukes i stedet for ratio). */
  triangles?: number;
  /**
   * Største avvik fra formen, som andel av modellens størrelse (0.01 = 1 %). Forenklingen stopper der, selv om målet
   * ikke er nådd. Standard 0.05.
   */
  maxError?: number;
}

export interface SimplifiedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  index?: Uint32Array;
  colors?: Uint8Array;
  uvs?: Float32Array;
  /** Midten av den nye formen i den gamle formens normaliserte rom (for å flytte objektet). */
  center: Vec3;
  /** Den nye formens størrelse som andel av den gamle (for å skalere objektet). */
  size: Vec3;
  before: number;
  after: number;
  /** Avviket fra formen, som andel av modellens største mål. */
  error: number;
}

/** Største avvik fra formen som standard: 5 % av modellens største mål (målet nås nesten alltid innenfor det). */
const DEFAULT_MAX_ERROR = 0.05;

/** Vekter for attributtene i feilmålet (meshoptimizer: endring 1/vekt over avstand d ≈ d i posisjon). */
const NORMAL_WEIGHT = 0.5;
const UV_WEIGHT = 1.5;
const COLOR_WEIGHT = 1;

export const simplifierReady = MeshoptSimplifier.ready;

export function triangleCount(asset: Pick<MeshAsset, "positions" | "index">): number {
  return (asset.index ? asset.index.length : asset.positions.length / 3) / 3;
}

/** Ønsket antall trekanter ut fra målet (minst én). */
export function targetTriangles(before: number, target: SimplifyTarget): number {
  if (target.triangles !== undefined) {
    if (!(Number.isFinite(target.triangles) && target.triangles >= 1)) throw new Error("triangles må være minst 1");
    return Math.min(before, Math.floor(target.triangles));
  }
  const ratio = target.ratio ?? 0.5;
  if (!(ratio > 0 && ratio <= 1)) throw new Error("ratio må være over 0 og høyst 1 (andelen trekanter som blir igjen)");
  return Math.max(1, Math.floor(before * ratio));
}

interface Welded {
  index: Uint32Array;
  /** Første hjørne i den opprinnelige bufferen for hvert sveisede hjørne. */
  source: Uint32Array;
  normals: Float32Array;
  /** Fasettert modell (hver trekant sin normal): resultatet får flate normaler igjen. */
  faceted: boolean;
}

/**
 * Sveiser hjørner med lik posisjon, UV, farge og (med `withNormals`) normal. Uten normalene i nøkkelen midles de –
 * det brukes for fasetterte modeller, som ellers ikke henger sammen noe sted.
 */
function weldBy(asset: MeshAsset, withNormals: boolean): Omit<Welded, "faceted"> {
  const { positions, normals: n, uvs, colors } = asset;
  const corners = asset.index ? asset.index.length : positions.length / 3;
  const q = (v: number) => Math.round(v * 1e6);
  const qn = (v: number) => Math.round(v * 200);
  const ids = new Map<string, number>();
  const index = new Uint32Array(corners);
  const source: number[] = [];
  const sums: number[] = [];
  for (let i = 0; i < corners; i++) {
    const v = asset.index ? asset.index[i] : i;
    let key = `${q(positions[v * 3])},${q(positions[v * 3 + 1])},${q(positions[v * 3 + 2])}`;
    if (withNormals) key += `|${qn(n[v * 3])},${qn(n[v * 3 + 1])},${qn(n[v * 3 + 2])}`;
    if (uvs) key += `|${q(uvs[v * 2])},${q(uvs[v * 2 + 1])}`;
    if (colors) key += `|${colors[v * 3]},${colors[v * 3 + 1]},${colors[v * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = source.length;
      ids.set(key, id);
      source.push(v);
      sums.push(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
    } else {
      sums[id * 3] += n[v * 3];
      sums[id * 3 + 1] += n[v * 3 + 1];
      sums[id * 3 + 2] += n[v * 3 + 2];
    }
    index[i] = id;
  }
  const normals = new Float32Array(sums);
  normalize(normals);
  return { index, source: new Uint32Array(source), normals };
}

/**
 * Normalene er med i nøkkelen, så harde kanter blir sømmer som holdes. Henger modellen nesten ikke sammen da
 * (fasetter: hver trekant har sin normal), sveises den uten normaler og får flate fasetter tilbake etterpå.
 */
function weld(asset: MeshAsset): Welded {
  const corners = asset.index ? asset.index.length : asset.positions.length / 3;
  const smooth = weldBy(asset, true);
  if (smooth.source.length < corners * 0.5) return { ...smooth, faceted: false };
  const loose = weldBy(asset, false);
  return loose.source.length < smooth.source.length * 0.6 ? { ...loose, faceted: true } : { ...smooth, faceted: false };
}

function normalize(normals: Float32Array) {
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
}

/** Forenkler formen. `scale` er objektets størrelse i meter (feilen måles i ekte mål). Krever `simplifierReady`. */
export function simplifyGeometry(asset: MeshAsset, scale: Vec3, target: SimplifyTarget): SimplifiedGeometry {
  if (!MeshoptSimplifier.supported) throw new Error("Forenkling krever WebAssembly");
  const before = triangleCount(asset);
  const wanted = targetTriangles(before, target);
  if (target.maxError !== undefined && !(target.maxError > 0)) throw new Error("max_error må være over 0");

  const welded = weld(asset);
  const count = welded.source.length;
  const s = scale.map((v) => Math.abs(v) || 1);
  const positions = new Float32Array(count * 3);
  // Attributter: normal (3), uv (2), farge (3) – det modellen har.
  const stride = 3 + (asset.uvs ? 2 : 0) + (asset.colors ? 3 : 0);
  const attributes = new Float32Array(count * stride);
  const weights = [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT];
  if (asset.uvs) weights.push(UV_WEIGHT, UV_WEIGHT);
  if (asset.colors) weights.push(COLOR_WEIGHT, COLOR_WEIGHT, COLOR_WEIGHT);
  for (let i = 0; i < count; i++) {
    const v = welded.source[i];
    for (let a = 0; a < 3; a++) positions[i * 3 + a] = asset.positions[v * 3 + a] * s[a];
    let k = i * stride;
    attributes.set(welded.normals.subarray(i * 3, i * 3 + 3), k);
    k += 3;
    if (asset.uvs) {
      attributes[k++] = asset.uvs[v * 2];
      attributes[k++] = asset.uvs[v * 2 + 1];
    }
    if (asset.colors) for (let a = 0; a < 3; a++) attributes[k++] = asset.colors[v * 3 + a] / 255;
  }

  // simplifyWithUpdate endrer bufferne; kopiene trengs hvis vi må prøve igjen uten Prune.
  const backup = { index: welded.index.slice(), positions: positions.slice(), attributes: attributes.slice() };
  let index = welded.index;
  const limit = target.maxError ?? DEFAULT_MAX_ERROR;
  // Prune: små løse biter (hårstrå, smuler) kan forsvinne helt i stedet for å stoppe forenklingen.
  let [indexCount, error] = MeshoptSimplifier.simplifyWithUpdate(index, positions, 3, attributes, stride, weights, null, wanted * 3, limit, ["Prune"]);
  if (!indexCount) {
    // Hele modellen er små biter (f.eks. et øye av to kuler): da beholdes bitene og bare forenkles.
    index = backup.index;
    positions.set(backup.positions);
    attributes.set(backup.attributes);
    [indexCount, error] = MeshoptSimplifier.simplifyWithUpdate(index, positions, 3, attributes, stride, weights, null, wanted * 3, limit, []);
  }
  if (!indexCount) throw new Error("Modellen ville forsvunnet helt – velg et høyere mål");
  // Kopi (ikke et vindu inn i den store bufferen), så den gamle indeksen kan ryddes bort.
  const kept = index.slice(0, indexCount);
  const [remap, unique] = MeshoptSimplifier.compactMesh(kept);

  const outPositions = new Float32Array(unique * 3);
  const outNormals = new Float32Array(unique * 3);
  const outUvs = asset.uvs ? new Float32Array(unique * 2) : undefined;
  const outColors = asset.colors ? new Uint8Array(unique * 3) : undefined;
  // remap er bare så lang som den høyeste indeksen som ble igjen (+1).
  for (let old = 0; old < remap.length; old++) {
    const n = remap[old];
    if (n === 0xffffffff || n >= unique) continue;
    for (let a = 0; a < 3; a++) outPositions[n * 3 + a] = positions[old * 3 + a] / s[a];
    let k = old * stride;
    outNormals.set(attributes.subarray(k, k + 3), n * 3);
    k += 3;
    if (outUvs) {
      outUvs[n * 2] = attributes[k++];
      outUvs[n * 2 + 1] = attributes[k++];
    }
    if (outColors) for (let a = 0; a < 3; a++) outColors[n * 3 + a] = Math.round(Math.min(1, Math.max(0, attributes[k++])) * 255);
  }
  normalize(outNormals);

  // Tilbake til enhetsboksen: sentrert og med størrelse 1 per akse (flate akser beholder 1, som ved import).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outPositions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], outPositions[i + a]);
      max[a] = Math.max(max[a], outPositions[i + a]);
    }
  }
  const center = [0, 1, 2].map((a) => (unique ? (min[a] + max[a]) / 2 : 0)) as Vec3;
  const size = [0, 1, 2].map((a) => (unique && max[a] - min[a] > 1e-5 ? max[a] - min[a] : 1)) as Vec3;
  for (let i = 0; i < outPositions.length; i += 3) {
    for (let a = 0; a < 3; a++) outPositions[i + a] = (outPositions[i + a] - center[a]) / size[a];
  }
  // Normalene står i den gamle normaliserte formen; den nye er strukket med 1/size per akse.
  for (let i = 0; i < outNormals.length; i += 3) for (let a = 0; a < 3; a++) outNormals[i + a] *= size[a];
  normalize(outNormals);

  const result: SimplifiedGeometry = {
    positions: outPositions,
    normals: outNormals,
    index: kept,
    ...(outUvs ? { uvs: outUvs } : {}),
    ...(outColors ? { colors: outColors } : {}),
    center,
    size,
    before,
    after: indexCount / 3,
    error,
  };
  return welded.faceted ? facet(result) : result;
}

/** Flate fasetter: hver trekant får egne hjørner og trekantens egen normal (som fasetterte egne former). */
function facet(g: SimplifiedGeometry): SimplifiedGeometry {
  const index = g.index!;
  const n = index.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = g.uvs ? new Float32Array(n * 2) : undefined;
  const colors = g.colors ? new Uint8Array(n * 3) : undefined;
  for (let i = 0; i < n; i++) {
    const v = index[i];
    positions.set(g.positions.subarray(v * 3, v * 3 + 3), i * 3);
    uvs?.set(g.uvs!.subarray(v * 2, v * 2 + 2), i * 2);
    colors?.set(g.colors!.subarray(v * 3, v * 3 + 3), i * 3);
  }
  for (let t = 0; t < n; t += 3) {
    const p = (k: number, a: number) => positions[(t + k) * 3 + a];
    const e1 = [0, 1, 2].map((a) => p(1, a) - p(0, a));
    const e2 = [0, 1, 2].map((a) => p(2, a) - p(0, a));
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(c[0], c[1], c[2]) || 1;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) normals[(t + k) * 3 + a] = c[a] / l;
  }
  const { index: _index, ...rest } = g;
  return { ...rest, positions, normals, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}
