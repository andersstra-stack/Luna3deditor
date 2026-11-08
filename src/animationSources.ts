// Animasjonsfiler som Python-skript (luna.import_animation) bruker, lest og tolket før skriptets endringer brukes:
// store.applyScript er synkron, mens filene leses asynkront. Uten imports fra appen, så store kan bruke det uten ring.

import type * as THREE from "three";

const sources = new Map<string, THREE.Object3D>();

export const animationSourceKey = (path: string) => path.replace(/[\\/]+/g, "/").toLowerCase();

export function putAnimationSource(path: string, source: THREE.Object3D) {
  sources.set(animationSourceKey(path), source);
}

/** Den leste fila (kastes hvis den ikke er lest inn først). */
export function animationSource(path: string): THREE.Object3D {
  const s = sources.get(animationSourceKey(path));
  if (!s) throw new Error(`Animasjonsfila ${path} er ikke lest inn`);
  return s;
}

export function clearAnimationSources() {
  sources.clear();
}
