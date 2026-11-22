// STL til 3D-print: sveising, reparasjon av T-skjøter og binær STL. Ren matte uten three, så den kan testes i Node.
//
// Hullene (CSG) gir T-skjøter: et hjørne midt på kanten til en annen trekant. Fila er da lukket i rommet, men ikke i
// nettet, og slicere melder «åpne kanter». repairMesh deler slike trekanter ved hjørnene som ligger på kanten.

export interface RepairedMesh {
  /** Trekantsuppe (x, y, z per hjørne, tre hjørner per trekant). */
  positions: Float32Array;
  triangles: number;
  /** Kanter som bare én trekant bruker etter reparasjonen (0 = lukket). */
  openEdges: number;
  /** Kanter som deles av mer enn to trekanter (overlappende deler som berører hverandre – ufarlig for slicere). */
  sharedEdges: number;
}

/** T-skjøt-reparasjonen er kvadratisk i antall åpne kanter – over dette hoppes den over (fila blir like brukbar). */
const MAX_REPAIR_EDGES = 20000;

/**
 * Sveiser hjørner som ligger nærmere enn `tol` (samme enhet som posisjonene), fjerner trekanter som faller sammen og
 * reparerer T-skjøter.
 */
export function repairMesh(soup: Float32Array, tol = 1e-3): RepairedMesh {
  // Sveis med rutenett: hvert hjørne ser etter et eksisterende hjørne i de 27 nabocellene.
  const verts: number[] = [];
  const cells = new Map<string, number[]>();
  const remap = new Uint32Array(soup.length / 3);
  for (let i = 0; i < soup.length / 3; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const cx = Math.round(x / tol), cy = Math.round(y / tol), cz = Math.round(z / tol);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          for (const v of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (Math.hypot(verts[v * 3] - x, verts[v * 3 + 1] - y, verts[v * 3 + 2] - z) <= tol) {
              found = v;
              break;
            }
          }
        }
    if (found < 0) {
      found = verts.length / 3;
      verts.push(x, y, z);
      const key = `${cx},${cy},${cz}`;
      const list = cells.get(key);
      if (list) list.push(found);
      else cells.set(key, [found]);
    }
    remap[i] = found;
  }
  const n = verts.length / 3;
  let tris: number[][] = [];
  for (let t = 0; t < remap.length; t += 3) {
    const tri = [remap[t], remap[t + 1], remap[t + 2]];
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) tris.push(tri);
  }

  const edgeKey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const countEdges = () => {
    const m = new Map<number, number>();
    for (const tri of tris) for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[k], tri[(k + 1) % 3]);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };

  for (let pass = 0; pass < 10; pass++) {
    const edges = countEdges();
    const open: number[] = [];
    for (const [key, c] of edges) if (c === 1) open.push(Math.floor(key / n), key % n);
    if (!open.length || open.length / 2 > MAX_REPAIR_EDGES) break;
    const openVerts = [...new Set(open)];
    let changed = false;
    const next: number[][] = [];
    for (const tri of tris) {
      let split: number[][] | null = null;
      for (let k = 0; k < 3 && !split; k++) {
        const a = tri[k], b = tri[(k + 1) % 3], c = tri[(k + 2) % 3];
        if (edges.get(edgeKey(a, b)) !== 1) continue;
        const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
        const ex = verts[b * 3] - ax, ey = verts[b * 3 + 1] - ay, ez = verts[b * 3 + 2] - az;
        const len2 = ex * ex + ey * ey + ez * ez;
        if (len2 === 0) continue;
        const on: [number, number][] = [];
        for (const v of openVerts) {
          if (v === a || v === b) continue;
          const px = verts[v * 3] - ax, py = verts[v * 3 + 1] - ay, pz = verts[v * 3 + 2] - az;
          const s = (px * ex + py * ey + pz * ez) / len2;
          if (s <= 1e-6 || s >= 1 - 1e-6) continue;
          if (Math.hypot(px - s * ex, py - s * ey, pz - s * ez) <= tol) on.push([s, v]);
        }
        if (!on.length) continue;
        on.sort((p, q) => p[0] - q[0]);
        const chain = [a, ...on.map((p) => p[1]), b];
        split = chain.slice(0, -1).map((v, i) => [v, chain[i + 1], c]);
      }
      if (split) {
        next.push(...split);
        changed = true;
      } else next.push(tri);
    }
    tris = next;
    if (!changed) break;
  }

  let openEdges = 0, sharedEdges = 0;
  for (const c of countEdges().values()) {
    if (c === 1) openEdges++;
    else if (c > 2) sharedEdges++;
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((tri, t) => tri.forEach((v, k) => positions.set(verts.slice(v * 3, v * 3 + 3), t * 9 + k * 3)));
  return { positions, triangles: tris.length, openEdges, sharedEdges };
}

/** Binær STL fra en trekantsuppe. Normalene regnes fra hjørnerekkefølgen (mot klokka sett utenfra). */
export function encodeStl(positions: Float32Array, header = "Luna 3D"): Uint8Array {
  const count = positions.length / 9;
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < Math.min(header.length, 80); i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const p = positions.subarray(t * 9, t * 9 + 9);
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
    const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let o = 84 + t * 50;
    for (const value of [nx, ny, nz, ...p]) {
      view.setFloat32(o, value, true);
      o += 4;
    }
  }
  return bytes;
}
