import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { SceneObject } from "../types";
import { objectBox, objectMatrix } from "../bounds";
import { geometryKey, geometryOf } from "./geometries";

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];
evaluator.useGroups = false;

// Egne kopier med bare attributtene CSG trenger (alle brushes må ha like attributter). Skjæres det i en modell med
// farge per hjørne eller tekstur, får også hullene hjørnefarger (hvite) og UV-er, så fargene følger med gjennom kuttet.
const brushGeometries = new Map<string, THREE.BufferGeometry>();
const ITEM_SIZE: Record<string, number> = { color: 3, uv: 2 };
function brushGeometry(o: SceneObject, keep: string[]): THREE.BufferGeometry {
  const key = `${geometryKey(o)}+${keep.join(",")}`;
  let geo = brushGeometries.get(key);
  if (!geo) {
    geo = geometryOf(o).clone();
    for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
    for (const name of keep) {
      if (geo.getAttribute(name)) continue;
      const size = ITEM_SIZE[name];
      geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count * size).fill(name === "color" ? 1 : 0), size));
    }
    geo.clearGroups();
    // Kurverør gir nye nøkler når de endres – kast de eldste.
    if (brushGeometries.size >= 200) {
      const [oldKey, old] = brushGeometries.entries().next().value!;
      brushGeometries.delete(oldKey);
      old.dispose();
    }
    brushGeometries.set(key, geo);
  }
  return geo;
}

/** Hullene som faktisk berører `solid` (grovsjekk med omsluttende bokser). */
export function overlappingHoles(solid: SceneObject, holes: SceneObject[]): SceneObject[] {
  if (!holes.length) return [];
  const box = objectBox(solid);
  return holes.filter((h) => box.intersectsBox(objectBox(h)));
}

/**
 * Trekker hullene fra `solid`. Resultatet er i solidens lokale koordinater,
 * slik at meshen kan beholde vanlig posisjon/rotasjon/størrelse.
 */
export function cutGeometry(solid: SceneObject, holes: SceneObject[]): THREE.BufferGeometry {
  const src = geometryOf(solid);
  const keep = ["position", "normal", ...["color", "uv"].filter((name) => src.getAttribute(name))];
  evaluator.attributes = keep;
  let result = new Brush(brushGeometry(solid, keep));
  result.updateMatrixWorld();
  const toLocal = objectMatrix(solid).invert();

  for (const hole of holes) {
    const brush = new Brush(brushGeometry(hole, keep));
    // Matrisen settes direkte (ikke via decompose) så skjevhet fra ujevnt skalerte, roterte former bevares.
    brush.matrixAutoUpdate = false;
    brush.matrix.copy(toLocal).multiply(objectMatrix(hole));
    brush.updateMatrixWorld(true);
    result = evaluator.evaluate(result, brush, SUBTRACTION);
  }
  return result.geometry;
}
