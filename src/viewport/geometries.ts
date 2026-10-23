import * as THREE from "three";
import type { ShapeType } from "../types";

// Én delt geometri per type – alle er enhetsstore og sentrert i origo.
const cache = new Map<ShapeType, THREE.BufferGeometry>();

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
