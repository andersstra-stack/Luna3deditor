import * as THREE from "three";
import { useEditor, type ObjectUpdate } from "./store";
import { hiddenFolderIds } from "./folders";
import { AXES, axisIndex, boxOf, objectBox, objectQuaternion, round, type Axis } from "./bounds";
import { SYMMETRIC_AXES, isHelper, isNode, type SceneObject, type Vec3 } from "./types";

const DEG = Math.PI / 180;

function pick(ids: string[]): SceneObject[] {
  const { objects } = useEditor.getState();
  const found = ids.map((id) => objects.find((o) => o.id === id));
  const missing = ids.filter((_, i) => !found[i]);
  if (missing.length) throw new Error(`Fant ikke objekt(er): ${missing.join(", ")}`);
  if (!found.length) throw new Error("Ingen objekter valgt");
  return found as SceneObject[];
}

/** Synlige, faste objekter som ikke er i `exclude` – det man kan lande på. */
function surfaces(exclude: Set<string>): SceneObject[] {
  const { objects, folders } = useEditor.getState();
  const hidden = hiddenFolderIds(folders);
  return objects.filter(
    (o) => !exclude.has(o.id) && o.visible && !o.hole && !isHelper(o.type) && !(o.folderId && hidden.has(o.folderId)),
  );
}

const moved = (o: SceneObject, delta: Vec3): ObjectUpdate => ({
  id: o.id,
  position: o.position.map((v, i) => round(v + delta[i])) as Vec3,
});

/**
 * Senker (eller løfter) utvalget som én enhet til det hviler på det øverste
 * objektet rett under seg – eller på bakken hvis det ikke er noe der.
 */
export function dropToGround(ids: string[]) {
  const sel = pick(ids);
  const box = boxOf(sel);
  let floor = 0;
  for (const o of surfaces(new Set(ids))) {
    const b = objectBox(o);
    const under = b.min.x < box.max.x && b.max.x > box.min.x && b.min.z < box.max.z && b.max.z > box.min.z;
    if (under && b.max.y <= box.min.y + 1e-3 && b.max.y > floor) floor = b.max.y;
  }
  const dy = floor - box.min.y;
  if (Math.abs(dy) > 1e-6) useEditor.getState().updateObjects(sel.map((o) => moved(o, [0, dy, 0])));
  return { dy: round(dy) };
}

export type AlignMode = "min" | "center" | "max";

/**
 * Innretter objektene etter hovedvalget (det sist valgte), eller etter
 * `targetId` om det er gitt. Hvert objekt flyttes for seg.
 */
export function alignObjects(ids: string[], axis: Axis, mode: AlignMode, targetId?: string) {
  const sel = pick(ids);
  const target = targetId ? pick([targetId])[0] : sel[sel.length - 1];
  const ref = objectBox(target);
  const value = (b: THREE.Box3) => (mode === "min" ? b.min[axis] : mode === "max" ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2);
  const goal = value(ref);
  const i = axisIndex(axis);
  const updates = sel
    .filter((o) => o.id !== target.id)
    .map((o) => {
      const delta: Vec3 = [0, 0, 0];
      delta[i] = goal - value(objectBox(o));
      return moved(o, delta);
    });
  if (updates.length) useEditor.getState().updateObjects(updates);
}

/** Speilvendt kopi av ett objekt om planet `axis = plane`. */
function mirrored(o: SceneObject, axis: Axis, plane: number): Pick<SceneObject, "position" | "rotation" | "scale"> {
  const i = axisIndex(axis);
  const position = [...o.position] as Vec3;
  position[i] = round(2 * plane - position[i]);

  // Rotasjonen speiles som M·R·M. Former som ikke er symmetriske om aksen må i tillegg snus 180°.
  const m = new THREE.Matrix4().makeScale(...(AXES.map((a) => (a === axis ? -1 : 1)) as Vec3));
  const r = new THREE.Matrix4().makeRotationFromQuaternion(objectQuaternion(o));
  const result = m.clone().multiply(r).multiply(m);
  const scale = [...o.scale] as Vec3;
  if (o.type === "mesh" || o.type === "curve") {
    // Importerte modeller og kurverør kan ha hvilken som helst form: speil selve geometrien med negativ størrelse.
    scale[i] = -scale[i];
  } else if (isNode(o.type)) {
    // M·R·Lx: forover (+Z) og opp (+Y) speiles som punktene rundt, uten negativ skala i eksporten.
    result.copy(m.clone().multiply(r).multiply(new THREE.Matrix4().makeScale(-1, 1, 1)));
  } else if (!(o.type === "cylinder" && (o.taper ?? 1) !== 1 ? "xz" : SYMMETRIC_AXES[o.type]).includes(axis)) {
    // (En avsmalnet sylinder er ikke lenger symmetrisk opp/ned.)
    result.multiply(axis === "x" ? new THREE.Matrix4().makeRotationY(Math.PI) : new THREE.Matrix4().makeRotationX(Math.PI));
  }
  const e = new THREE.Euler().setFromRotationMatrix(result, "XYZ");
  const rotation = [e.x, e.y, e.z].map((v) => round(v / DEG, 0.01)) as Vec3;
  return { position, rotation, scale };
}

/**
 * Speiler utvalget. Med `copy` lages speilvendte kopier (standardplan: aksen = 0,
 * som for symmetriske modeller), ellers snus utvalget på stedet (plan: midten av utvalget).
 */
export function mirrorObjects(ids: string[], axis: Axis, copy: boolean, plane?: number) {
  const sel = pick(ids);
  const box = boxOf(sel);
  const p = plane ?? (copy ? 0 : (box.min[axis] + box.max[axis]) / 2);
  const state = useEditor.getState();
  if (copy) {
    const copies = state.duplicateObjects(ids, [0, 0, 0]);
    // duplicateObjects la allerede kopiene i historikken; speilingen skal ikke bli et eget angre-steg.
    state.updateObjectsLive(copies.map((c, k) => ({ id: c.id, ...mirrored(sel[k], axis, p) })));
    return copies.map((c) => c.id);
  }
  state.updateObjects(sel.map((o) => ({ id: o.id, ...mirrored(o, axis, p) })));
  return ids;
}
