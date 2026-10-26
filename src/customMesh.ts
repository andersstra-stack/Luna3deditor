// Egne former fra hjørner og trekanter (MCP add_objects / Python luna.mesh): blader, steiner, kapper – alt som ikke
// er en grunnform. Hjørnene er i objektets eget koordinatsystem i meter: `position` er der origo havner og `rotation`
// dreier rundt det. Geometrien normaliseres til enhetsboksen som importerte modeller, så `scale` blir målene.
// Like former (samme hjørner/trekanter/farger) deler én modell i registeret – 400 like blader lagres én gang.

import * as THREE from "three";
import { hasMesh, registerMesh } from "./meshes";
import type { SceneObject, Vec3 } from "./types";

export interface MeshInput {
  vertices?: Vec3[];
  triangles?: [number, number, number][];
  /** Farge per hjørne (#rrggbb), samme rekkefølge som `vertices`. */
  vertex_colors?: string[];
  /** true = myke overganger mellom trekanter som deler hjørner; ellers flate fasetter. */
  smooth?: boolean;
}

const MAX_TRIANGLES = 200_000;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** FNV-1a – kort, stabil nøkkel for like former. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function check(input: MeshInput): Required<Pick<MeshInput, "vertices" | "triangles">> {
  const { vertices, triangles } = input;
  if (!Array.isArray(vertices) || vertices.length < 3) throw new Error("vertices må være minst tre hjørner [x, y, z]");
  for (const v of vertices) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`Ugyldig hjørne ${JSON.stringify(v)} – hvert hjørne er [x, y, z] i meter`);
    }
  }
  if (!Array.isArray(triangles) || !triangles.length) throw new Error("triangles må være minst én trekant [a, b, c] (hjørnenumre fra 0)");
  if (triangles.length > MAX_TRIANGLES) throw new Error(`For mange trekanter (${triangles.length}, maks ${MAX_TRIANGLES})`);
  for (const t of triangles) {
    if (!Array.isArray(t) || t.length !== 3 || !t.every((i) => Number.isInteger(i) && i >= 0 && i < vertices.length)) {
      throw new Error(`Ugyldig trekant ${JSON.stringify(t)} – tre hjørnenumre mellom 0 og ${vertices.length - 1}`);
    }
  }
  if (input.vertex_colors !== undefined) {
    const c = input.vertex_colors;
    if (!Array.isArray(c) || c.length !== vertices.length || !c.every((x) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x))) {
      throw new Error("vertex_colors må være én hex-farge (#rrggbb) per hjørne");
    }
  }
  return { vertices, triangles };
}

/**
 * Registrerer formen (eller gjenbruker en lik) og regner ut plasseringen: objektets midtpunkt er midten av hjørnene,
 * flyttet og dreid med `position`/`rotation`, og `scale` er formens mål.
 */
export function meshFromVertices(
  input: MeshInput,
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  name = "Egen form",
): Pick<SceneObject, "meshId" | "position" | "rotation" | "scale"> {
  const { vertices, triangles } = check(input);
  const smooth = input.smooth === true;
  const colors = input.vertex_colors;

  const box = new THREE.Box3();
  for (const v of vertices) box.expandByPoint(new THREE.Vector3(...v));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).toArray().map((v) => (v > 1e-5 ? v : 1)) as Vec3;

  const meshId = `mesh_v${hash(JSON.stringify([vertices, triangles, colors ?? null, smooth]))}`;
  if (!hasMesh(meshId)) {
    // Normalisert til enhetsboksen; normalene regnes på den normaliserte formen (riktig når scale legges på igjen).
    const norm = (v: Vec3) => v.map((x, a) => (x - c.getComponent(a)) / size[a]);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const geo = new THREE.BufferGeometry();
    let colorBytes: Uint8Array | undefined;
    if (smooth) {
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flatMap(norm), 3));
      geo.setIndex(triangles.flat());
      if (colors) colorBytes = new Uint8Array(colors.flatMap(rgb));
    } else {
      // Flate fasetter: hver trekant får egne hjørner.
      const corners = triangles.flat();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap((i) => norm(vertices[i])), 3));
      if (colors) colorBytes = new Uint8Array(corners.flatMap((i) => rgb(colors[i])));
    }
    geo.computeVertexNormals();
    // En form med bare én hjørnefarge trenger ikke farge per hjørne (objektets farge gjør jobben).
    const single = !colorBytes || colorBytes.every((v, i) => v === colorBytes![i % 3]);
    registerMesh({
      id: meshId,
      name,
      positions: geo.getAttribute("position").array as Float32Array,
      normals: geo.getAttribute("normal").array as Float32Array,
      ...(smooth ? { index: new Uint32Array(triangles.flat()) } : {}),
      ...(single ? {} : { colors: colorBytes }),
    });
    geo.dispose();
  }

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation.map(THREE.MathUtils.degToRad) as Vec3), "XYZ"));
  const center = c.clone().applyQuaternion(q).add(new THREE.Vector3(...position));
  return { meshId, position: center.toArray().map(r4) as Vec3, rotation, scale: size.map(r4) as Vec3 };
}

/** Den ene hjørnefargen, hvis formen bare har én (blir objektets farge). */
export function singleVertexColor(input: MeshInput): string | undefined {
  const c = input.vertex_colors;
  return c && c.every((x) => x.toLowerCase() === c[0].toLowerCase()) ? c[0] : undefined;
}
