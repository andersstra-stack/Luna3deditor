import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { SceneObject } from "../types";
import { objectBox, objectMatrix } from "../bounds";
import { geometryDetail, geometryOf } from "./geometries";

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];
evaluator.useGroups = false;

// Egne kopier med bare attributtene CSG trenger (alle brushes må ha like attributter).
const brushGeometries = new Map<string, THREE.BufferGeometry>();
function brushGeometry(o: SceneObject): THREE.BufferGeometry {
  const key = o.type === "mesh" ? `mesh:${o.meshId}` : `${o.type}:${geometryDetail()}`;
  let geo = brushGeometries.get(key);
  if (!geo) {
    geo = geometryOf(o).clone();
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    geo.clearGroups();
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
  let result = new Brush(brushGeometry(solid));
  result.updateMatrixWorld();
  const toLocal = objectMatrix(solid).invert();

  for (const hole of holes) {
    const brush = new Brush(brushGeometry(hole));
    // Matrisen settes direkte (ikke via decompose) så skjevhet fra ujevnt skalerte, roterte former bevares.
    brush.matrixAutoUpdate = false;
    brush.matrix.copy(toLocal).multiply(objectMatrix(hole));
    brush.updateMatrixWorld(true);
    result = evaluator.evaluate(result, brush, SUBTRACTION);
  }
  return result.geometry;
}
