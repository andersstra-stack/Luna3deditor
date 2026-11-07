// Binding av modeller til skjelett med automatiske hudvekter (som «With Automatic Weights» i Blender, men enklere):
// hvert hjørne får vekt etter avstanden til beinsegmentene (rot → tupp), de nærmeste dominerer kraftig (1/d⁴), og
// vektene glattes ut over naboene i nettet så leddene bøyer mykt. Fire bein per hjørne, som i glTF.

import * as THREE from "three";
import { getMeshAsset, registerMesh } from "./meshes";
import { objectMatrix } from "./bounds";
import { boneTail, bonesInOrder } from "./bones";
import { isBone, type MeshAsset, type SceneObject, type Skin } from "./types";

/** Hvor mange ganger vektene glattes ut over naboene. */
const SMOOTH_ITERATIONS = 3;
const SMOOTH_AMOUNT = 0.5;
/** Bein med under denne andelen av hjørnets største vekt tas ikke med. */
const MIN_SHARE = 0.02;

let counter = 0;

/** Er objektet bundet til et skjelett (og har vektene)? */
export function isSkinned(o: Pick<SceneObject, "type" | "meshId" | "skin">): boolean {
  if (o.type !== "mesh" || !o.skin?.bones.length || !o.meshId) return false;
  return !!getMeshAsset(o.meshId)?.weights;
}

/** Et bein på utsiden av flaten (i normalens retning) teller som så mye lenger unna – i praksis ikke med. */
const OUTSIDE_PENALTY = 5;

/**
 * Avstanden fra p til segmentet a–b. Ligger nærmeste punkt på utsiden av flaten (sett fra normalen n), straffes
 * avstanden: en hånd som henger inntil hofta skal ikke dra med seg buksa, og armhulen ikke siden av genseren.
 */
function segmentDistance(p: THREE.Vector3, n: THREE.Vector3, a: THREE.Vector3, ab: THREE.Vector3, abLen2: number): number {
  const t = abLen2 > 0 ? THREE.MathUtils.clamp((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z, 0, abLen2) / abLen2 : 0;
  const dx = a.x + ab.x * t - p.x;
  const dy = a.y + ab.y * t - p.y;
  const dz = a.z + ab.z * t - p.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const outside = dist > 1e-6 && dx * n.x + dy * n.y + dz * n.z > 0;
  return outside ? dist * OUTSIDE_PENALTY : dist;
}

/** Punkter langs hvert bein som testes for om beinet går gjennom modellen. */
const INSIDE_SAMPLES = 9;

/**
 * Hvilke bein går gjennom innsiden av modellen? Et punkt på beinet er inne når det ligger bak normalen til nærmeste
 * hjørne. Bein som bare passerer utenfor (lårbeinet ved siden av en hånd, håndbeinet ved hofta på buksa) får ikke
 * påvirke modellen. Er ingen bein inne (tynne eller åpne former), får alle være med.
 */
function bonesInside(points: THREE.Vector3[], normals: THREE.Vector3[], heads: THREE.Vector3[], axes: THREE.Vector3[]): boolean[] {
  const q = new THREE.Vector3();
  const result = heads.map((head, i) => {
    for (let k = 0; k < INSIDE_SAMPLES; k++) {
      q.copy(axes[i]).multiplyScalar((k + 0.5) / INSIDE_SAMPLES).add(head);
      let best = -1;
      let bestD = Infinity;
      for (let w = 0; w < points.length; w++) {
        const dd = points[w].distanceToSquared(q);
        if (dd < bestD) {
          bestD = dd;
          best = w;
        }
      }
      if (best >= 0 && normals[best].dot(q.clone().sub(points[best])) < 0) return true;
    }
    return false;
  });
  return result.some(Boolean) ? result : result.map(() => true);
}

/** Automatiske vekter for modellen til `obj` mot `bones` (i den rekkefølgen – indeksene peker dit). */
export function autoWeights(obj: SceneObject, asset: MeshAsset, bones: SceneObject[]): { joints: Uint16Array; weights: Float32Array } {
  const B = bones.length;
  const count = asset.positions.length / 3;
  const m = objectMatrix(obj);

  // Hjørner på samme sted (sømmer i UV/farger) regnes som ett, så de får like vekter.
  const ids = new Map<string, number>();
  const welded = new Uint32Array(count);
  const points: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  // Normalene i verdensrommet (geometrien er normalisert og strukket med scale): inverstransponert.
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const q = (v: number) => Math.round(v * 1e5);
  const p = asset.positions;
  const nrm = asset.normals;
  for (let v = 0; v < count; v++) {
    const key = `${q(p[v * 3])},${q(p[v * 3 + 1])},${q(p[v * 3 + 2])}`;
    let id = ids.get(key);
    const n = new THREE.Vector3(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]).applyMatrix3(normalMatrix);
    if (id === undefined) {
      id = points.length;
      ids.set(key, id);
      points.push(new THREE.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).applyMatrix4(m));
      normals.push(n.normalize());
    } else {
      normals[id].add(n.normalize());
    }
    welded[v] = id;
  }
  const W = points.length;
  for (const n of normals) n.normalize();

  // Råvekter fra avstanden til hvert bein.
  const heads = bones.map((b) => new THREE.Vector3(...b.position));
  const axes = bones.map((b, i) => new THREE.Vector3(...boneTail(b)).sub(heads[i]));
  const len2 = axes.map((a) => a.lengthSq());
  const inside = bonesInside(points, normals, heads, axes);
  let weights = new Float32Array(W * B);
  const d = new Float32Array(B);
  for (let w = 0; w < W; w++) {
    let min = Infinity;
    for (let i = 0; i < B; i++) {
      d[i] = inside[i] ? segmentDistance(points[w], normals[w], heads[i], axes[i], len2[i]) : Infinity;
      min = Math.min(min, d[i]);
    }
    const floor = Math.max(min, 1e-4);
    let sum = 0;
    for (let i = 0; i < B; i++) {
      const r = floor / Math.max(d[i], 1e-4);
      const v = r * r * r * r;
      weights[w * B + i] = v;
      sum += v;
    }
    for (let i = 0; i < B; i++) weights[w * B + i] /= sum;
  }

  // Naboer i nettet (via trekantene) – vektene glattes ut, så overgangene ved leddene blir myke.
  const corner = (k: number) => welded[asset.index ? asset.index[k] : k];
  const corners = asset.index ? asset.index.length : count;
  const degree = new Uint32Array(W + 1);
  for (let k = 0; k < corners; k += 3) {
    for (let e = 0; e < 3; e++) {
      degree[corner(k + e)] += 2;
    }
  }
  const start = new Uint32Array(W + 1);
  for (let w = 0; w < W; w++) start[w + 1] = start[w] + degree[w];
  const fill = start.slice();
  const neighbors = new Uint32Array(start[W]);
  for (let k = 0; k < corners; k += 3) {
    const a = corner(k);
    const b = corner(k + 1);
    const c = corner(k + 2);
    neighbors[fill[a]++] = b;
    neighbors[fill[a]++] = c;
    neighbors[fill[b]++] = c;
    neighbors[fill[b]++] = a;
    neighbors[fill[c]++] = a;
    neighbors[fill[c]++] = b;
  }
  for (let it = 0; it < SMOOTH_ITERATIONS; it++) {
    const next = new Float32Array(W * B);
    for (let w = 0; w < W; w++) {
      const n = start[w + 1] - start[w];
      for (let i = 0; i < B; i++) {
        let avg = 0;
        for (let k = start[w]; k < start[w + 1]; k++) avg += weights[neighbors[k] * B + i];
        next[w * B + i] = n ? (1 - SMOOTH_AMOUNT) * weights[w * B + i] + (SMOOTH_AMOUNT * avg) / n : weights[w * B + i];
      }
    }
    weights = next;
  }

  // De fire tyngste beina per hjørne, normalisert.
  const joints = new Uint16Array(count * 4);
  const out = new Float32Array(count * 4);
  const best = new Int32Array(4);
  const bestW = new Float32Array(4);
  const perWelded = new Map<number, [Uint16Array, Float32Array]>();
  for (let v = 0; v < count; v++) {
    const w = welded[v];
    let cached = perWelded.get(w);
    if (!cached) {
      best.fill(-1);
      bestW.fill(0);
      for (let i = 0; i < B; i++) {
        const x = weights[w * B + i];
        if (x <= bestW[3]) continue;
        let k = 3;
        while (k > 0 && x > bestW[k - 1]) {
          bestW[k] = bestW[k - 1];
          best[k] = best[k - 1];
          k--;
        }
        bestW[k] = x;
        best[k] = i;
      }
      const j = new Uint16Array(4);
      const ws = new Float32Array(4);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        if (best[k] < 0 || bestW[k] < bestW[0] * MIN_SHARE) continue;
        j[k] = best[k];
        ws[k] = bestW[k];
        sum += bestW[k];
      }
      for (let k = 0; k < 4; k++) ws[k] /= sum || 1;
      if (!sum) ws[0] = 1;
      cached = [j, ws];
      perWelded.set(w, cached);
    }
    joints.set(cached[0], v * 4);
    out.set(cached[1], v * 4);
  }
  return { joints, weights: out };
}

/**
 * Modellen bundet til beina: en ny modell i registeret med vektene, og `skin` på objektet. Uten `boneIds` brukes alle
 * beina i scenen. Gir endringene, eller grunnen til at objektet ble hoppet over.
 */
export function skinnedObject(
  obj: SceneObject,
  objects: SceneObject[],
  boneIds?: string[],
): { update: Pick<SceneObject, "meshId" | "skin">; bones: number } | { skip: string } {
  const asset = obj.type === "mesh" && obj.meshId ? getMeshAsset(obj.meshId) : undefined;
  if (!asset) return { skip: "ikke en modell (type mesh)" };
  const byId = new Map(objects.map((o) => [o.id, o]));
  const picked = boneIds
    ? boneIds.map((id) => {
        const b = byId.get(id);
        if (!b || !isBone(b.type)) throw new Error(`${b ? b.name : id} er ikke et bein`);
        return b;
      })
    : objects.filter((o) => isBone(o.type));
  if (!picked.length) return { skip: "det finnes ingen bein å binde til" };
  const bones = bonesInOrder(picked);
  const { joints, weights } = autoWeights(obj, asset, bones);
  const meshId = `mesh_k${Date.now().toString(36)}_${(counter++).toString(36)}`;
  registerMesh({ ...asset, id: meshId, joints, weights });
  const skin: Skin = { bones: bones.map((b) => b.id) };
  return { update: { meshId, skin }, bones: bones.length };
}
