import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { SceneObject } from "../types";
import { objectBox, objectMatrix } from "../bounds";
import { geometryKey, geometryOf } from "./geometries";

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];
evaluator.useGroups = false;

// Egne kopier med bare attributtene CSG trenger (alle brushes må ha like attributter). Skjæres det i en modell med
// farge per hjørne, får også hullene hjørnefarger (hvite), så fargene følger med gjennom kuttet.
const brushGeometries = new Map<string, THREE.BufferGeometry>();
function brushGeometry(o: SceneObject, withColor: boolean): THREE.BufferGeometry {
  const key = `${geometryKey(o)}${withColor ? "+color" : ""}`;
  let geo = brushGeometries.get(key);
  if (!geo) {
    geo = geometryOf(o).clone();
    const keep = withColor ? ["position", "normal", "color"] : ["position", "normal"];
    for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
    if (withColor && !geo.getAttribute("color")) {
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3).fill(1), 3));
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
  const withColor = !!geometryOf(solid).getAttribute("color");
  evaluator.attributes = withColor ? ["position", "normal", "color"] : ["position", "normal"];
  let result = new Brush(brushGeometry(solid, withColor));
  result.updateMatrixWorld();
  const toLocal = objectMatrix(solid).invert();

  for (const hole of holes) {
    const brush = new Brush(brushGeometry(hole, withColor));
    // Matrisen settes direkte (ikke via decompose) så skjevhet fra ujevnt skalerte, roterte former bevares.
    brush.matrixAutoUpdate = false;
    brush.matrix.copy(toLocal).multiply(objectMatrix(hole));
    brush.updateMatrixWorld(true);
    result = evaluator.evaluate(result, brush, SUBTRACTION);
  }
  return result.geometry;
}
