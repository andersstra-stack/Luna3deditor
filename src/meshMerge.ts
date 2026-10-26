// «Slå sammen» (som Ctrl+J i Blender): de valgte delene blir én modell (`type: "mesh"`) på samme sted.
// Geometrien bakes inn i verdensrommet og normaliseres til enhetsboksen igjen. Hver del beholder fargen sin
// (farge per hjørne, se MeshAsset.colors); resten av utseendet (metall, ruhet, glød, materialnavn) kommer fra
// hovedvalget. Hull og hjelpere (lys, noder) blir med som de er – hull i samme mappe skjærer fortsatt i den
// sammenslåtte modellen.

import * as THREE from "three";
import { newId, useEditor } from "./store";
import { hasTextureMap, registerMesh, vertexHexes } from "./meshes";
import { objectMatrix, round } from "./bounds";
import { geometryOf } from "./viewport/geometries";
import { isHelper, type SceneObject, type Vec3 } from "./types";

export interface MergeResult {
  id: string;
  name: string;
  merged: number;
  /** Valgte objekter som ikke ble med, og hvorfor. */
  skipped: { name: string; reason: string }[];
}

/** «navn.3» / «navn 3» → «navn», så bitene fra en oppdeling får tilbake navnet sitt. */
const baseName = (name: string) => name.replace(/[. ]\d+$/, "");

export function mergeObjects(ids: string[]): MergeResult {
  const state = useEditor.getState();
  const objs = ids.map((id) => {
    const o = state.objects.find((x) => x.id === id);
    if (!o) throw new Error(`Fant ikke objekt ${id}`);
    return o;
  });
  const skipped: MergeResult["skipped"] = [];
  const parts: SceneObject[] = [];
  for (const o of objs) {
    if (isHelper(o.type)) skipped.push({ name: o.name, reason: "lys og noder slås ikke sammen" });
    else if (o.hole) skipped.push({ name: o.name, reason: "er et hull" });
    else if (hasTextureMap(o)) skipped.push({ name: o.name, reason: "har tekstur – slås ikke sammen" });
    else parts.push(o);
  }
  if (parts.length < 2) throw new Error("Velg minst to former eller modeller å slå sammen");
  // Hovedvalget (sist valgte) bestemmer navn, mappe og utseende.
  const primary = [...parts].reverse().find((o) => o.id === state.selectedIds[state.selectedIds.length - 1]) ?? parts[parts.length - 1];

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const rgb = new THREE.Color();
  for (const o of parts) {
    const src = geometryOf(o);
    const geo = (src.index ? src.toNonIndexed() : src.clone()) as THREE.BufferGeometry;
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const m = objectMatrix(o);
    geo.applyMatrix4(m);
    const p = geo.getAttribute("position");
    const n = geo.getAttribute("normal");
    // Modeller som allerede har flere farger beholder dem; ellers får alle hjørnene delens farge.
    const hexes = vertexHexes(geo);
    const own = rgb.set(o.color).getHexString();
    // Speilet objekt (negativ størrelse): snu trekantene, ellers vender flatene innover.
    const order = m.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < p.count; t += 3) {
      for (const k of order) {
        positions.push(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
        normals.push(n.getX(t + k), n.getY(t + k), n.getZ(t + k));
        const hex = hexes ? hexes[t + k].slice(1) : own;
        colors.push(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
      }
    }
    geo.dispose();
  }

  const pos = new Float32Array(positions);
  const box = new THREE.Box3().setFromArray(pos);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const s = [size.x, size.y, size.z].map((v) => (v > 1e-5 ? v : 1));
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) pos[i + a] = (pos[i + a] - c.getComponent(a)) / s[a];
  }

  const name = baseName(primary.name) || primary.name;
  const meshId = newId("mesh");
  // Bare én farge i alt: vanlig modell med den fargen (som før).
  const single = colors.every((v, i) => v === colors[i % 3]);
  const singleHex = `#${colors.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  registerMesh({
    id: meshId,
    name,
    positions: pos,
    normals: new Float32Array(normals),
    ...(single ? {} : { colors: new Uint8Array(colors) }),
  });

  const [created] = state.replaceObjects(
    parts.map((o) => o.id),
    [
      {
        type: "mesh",
        meshId,
        name,
        position: c.toArray().map((v) => round(v)) as Vec3,
        rotation: [0, 0, 0],
        scale: s.map((v) => round(v, 1e-4)) as Vec3,
        color: single ? singleHex : primary.color,
        metalness: primary.metalness,
        roughness: primary.roughness,
        opacity: primary.opacity,
        ...(primary.emissive ? { emissive: primary.emissive } : {}),
        ...(primary.material ? { material: primary.material } : {}),
        visible: true,
        folderId: primary.folderId,
      },
    ],
  );
  state.setActivity(`Slo sammen ${parts.length} deler til ${created.name}${skipped.length ? ` (${skipped.length} hoppet over)` : ""}`);
  return { id: created.id, name: created.name, merged: parts.length, skipped };
}
