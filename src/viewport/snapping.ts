import * as THREE from "three";
import { AXES } from "../bounds";

/**
 * Objekt-snapping mens man flytter: utvalgets boks "klikker" på plass slik at
 * flater ligger helt inntil (eller kant i kant med) andre objekter og bakken.
 */
export interface SnapContext {
  /** Utvalgets boks da dra-operasjonen startet. */
  startBox: THREE.Box3;
  /** Bokser for alle andre synlige objekter (de flytter seg ikke under dra). */
  others: THREE.Box3[];
}

const EPS = 1e-4;

/** Overlapper boksene på aksen (med litt slingringsmonn)? */
function overlaps(a: THREE.Box3, b: THREE.Box3, axis: (typeof AXES)[number], slack = 0) {
  return a.min[axis] < b.max[axis] + slack - EPS && a.max[axis] > b.min[axis] - slack + EPS;
}

/**
 * Hvor mye utvalget bør dyttes for å snappe, gitt hvor langt det er flyttet.
 * @param moved   forflytning siden start
 * @param axes    aksene gizmoen drar langs, f.eks. "X", "XZ" eller "XYZ"
 * @param threshold maks avstand (meter) som snapper
 */
export function snapOffset(ctx: SnapContext, moved: THREE.Vector3, axes: string, threshold: number): THREE.Vector3 {
  const box = ctx.startBox.clone().translate(moved);
  const result = new THREE.Vector3();

  for (const axis of AXES) {
    if (!axes.includes(axis.toUpperCase())) continue;
    const rest = AXES.filter((a) => a !== axis);
    const best = { offset: Infinity };
    const consider = (offset: number) => {
      if (Math.abs(offset) <= threshold && Math.abs(offset) < Math.abs(best.offset)) best.offset = offset;
    };

    // Bakken: stå på y = 0.
    if (axis === "y") consider(-box.min.y);

    for (const other of ctx.others) {
      // Inntil hverandre: krever at boksene overlapper på de to andre aksene.
      if (rest.every((a) => overlaps(box, other, a))) {
        consider(other.max[axis] - box.min[axis]);
        consider(other.min[axis] - box.max[axis]);
      }
      // Kant i kant / midt på: når de er naboer på minst én av de andre aksene.
      if (rest.some((a) => overlaps(box, other, a, threshold))) {
        consider(other.min[axis] - box.min[axis]);
        consider(other.max[axis] - box.max[axis]);
        consider((other.min[axis] + other.max[axis]) / 2 - (box.min[axis] + box.max[axis]) / 2);
      }
    }
    if (Number.isFinite(best.offset)) result[axis] = best.offset;
  }
  return result;
}
