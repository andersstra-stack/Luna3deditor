import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SceneObject, ShapeType } from "../types";
import { meshGeometry } from "../meshes";

// Én delt geometri per type – alle er enhetsstore og sentrert i origo.
const cache = new Map<ShapeType, THREE.BufferGeometry>();

/** Ekstruderer en 2D-profil (i XY, innenfor ±0.5) én meter langs Z, sentrert. */
function extrude(points: [number, number][]): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5);
  return geo;
}

function build(type: ShapeType): THREE.BufferGeometry {
  switch (type) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 48, 24);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 48);
    case "torus":
      // Ligger flatt, ytre diameter 1.
      return new THREE.TorusGeometry(0.35, 0.15, 24, 64).rotateX(Math.PI / 2);
    case "plane":
      // Ligger flatt på bakken.
      return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    case "capsule":
      return new THREE.CapsuleGeometry(0.25, 0.5, 8, 24);
    case "wedge":
      // Rampe: høy ende ved -X, lav ende ved +X.
      return extrude([
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
      ]);
    case "prism":
      // Saltak: mønet går langs Z.
      return extrude([
        [-0.5, -0.5],
        [0.5, -0.5],
        [0, 0.5],
      ]);
    case "pyramid":
      // Kvadratisk grunnflate 1×1 med kantene langs aksene.
      return new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
    case "stairs": {
      // Fire trinn som stiger mot +X.
      const pts: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]];
      for (let i = 3; i >= 1; i--) {
        const x = -0.5 + i * 0.25;
        const y = -0.5 + i * 0.25;
        pts.push([x, y + 0.25], [x, y]);
      }
      pts.push([-0.5, -0.25]);
      return extrude(pts);
    }
    case "hemisphere": {
      // Kuppel + bunnplate (lukket, slik at hull/CSG fungerer). Fyller 1×1×1; standardhøyde settes via scale.
      const dome = new THREE.SphereGeometry(0.5, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const base = new THREE.CircleGeometry(0.5, 48).rotateX(Math.PI / 2);
      const geo = mergeGeometries([dome, base])!;
      return geo.scale(1, 2, 1).translate(0, -0.5, 0);
    }
    case "tube": {
      const shape = new THREE.Shape().absarc(0, 0, 0.5, 0, Math.PI * 2, false);
      shape.holes.push(new THREE.Path().absarc(0, 0, 0.35, 0, Math.PI * 2, true));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 48 });
      return geo.translate(0, 0, -0.5).rotateX(-Math.PI / 2);
    }
    case "roundedBox":
      return new RoundedBoxGeometry(1, 1, 1, 4, 0.12);
    case "pointLight":
      // Markøren som vises i editoren.
      return new THREE.SphereGeometry(0.5, 24, 12);
    case "spotLight":
      // Kjegle som peker nedover (-Y), samme vei som lyset.
      return new THREE.ConeGeometry(0.5, 1, 24).rotateX(Math.PI);
    case "node": {
      // Markøren i editoren: kule i punktet, pil langs +Z (forover) og en kort pinne langs +Y (opp).
      const ball = new THREE.SphereGeometry(0.12, 16, 8);
      const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8).rotateX(Math.PI / 2).translate(0, 0, 0.16);
      const tip = new THREE.ConeGeometry(0.09, 0.18, 12).rotateX(Math.PI / 2).translate(0, 0, 0.41);
      const up = new THREE.CylinderGeometry(0.022, 0.022, 0.3, 6).translate(0, 0.15, 0);
      return mergeGeometries([ball, shaft, tip, up])!;
    }
    case "mesh":
      // Importerte modeller har egen geometri – se geometryOf().
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function getGeometry(type: ShapeType): THREE.BufferGeometry {
  let geo = cache.get(type);
  if (!geo) {
    geo = build(type);
    cache.set(type, geo);
  }
  return geo;
}

/** Geometrien til et objekt – for importerte modeller fra modellregisteret. */
export function geometryOf(o: Pick<SceneObject, "type" | "meshId">): THREE.BufferGeometry {
  return o.type === "mesh" && o.meshId ? meshGeometry(o.meshId) : getGeometry(o.type);
}
