import * as THREE from "three";
import type { RootState } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useEditor } from "../store";
import { isVisibleNote, noteWorldPosition } from "../notes";
import { boxOf, round } from "../bounds";
import { isInside } from "../folders";
import { isHelper, type Vec3 } from "../types";

/**
 * Gir kode utenfor <Canvas> (MCP-broen, eksport) tilgang til three.js-tilstanden.
 */
let getState: (() => RootState) | null = null;

export function setThreeGetter(get: () => RootState) {
  getState = get;
}

export function three(): RootState {
  if (!getState) throw new Error("3D-visningen er ikke klar ennå");
  return getState();
}

export const VIEWS = ["current", "front", "back", "left", "right", "top", "iso"] as const;
export type ViewName = (typeof VIEWS)[number];

const VIEW_DIRS: Record<Exclude<ViewName, "current">, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.15, 1),
  back: new THREE.Vector3(0, 0.15, -1),
  left: new THREE.Vector3(-1, 0.15, 0),
  right: new THREE.Vector3(1, 0.15, 0),
  top: new THREE.Vector3(0, 1, 0.001),
  iso: new THREE.Vector3(1, 0.8, 1),
};

/** Alle scene-objekter (ikke hjelpere som rutenett og gizmo). */
export function sceneMeshes(): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  three().scene.traverse((o) => {
    if (o.userData.lunaId && (o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

/** Plasserer kameraet slik at hele scenen synes fra gitt retning. */
export function frameScene(view: ViewName = "iso") {
  const box = new THREE.Box3();
  for (const m of sceneMeshes()) if (m.visible) box.expandByObject(m);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  frameBox(box, view);
}

/**
 * Rammer inn objekter (og alt i mapper, når id-en er en mappe) fra gitt retning. `zoom` over 1 går nærmere,
 * under 1 lenger unna.
 */
export function frameObjects(ids: string[], view: ViewName = "current", zoom = 1) {
  const { objects, folders } = useEditor.getState();
  const folderIds = ids.filter((id) => folders.some((f) => f.id === id));
  const chosen = objects.filter((o) => ids.includes(o.id) || (o.folderId && folderIds.some((f) => isInside(folders, o.folderId, f))));
  if (!chosen.length) throw new Error(`Fant ingen objekter å fokusere på (${ids.join(", ")})`);
  frameBox(boxOf(chosen), view, zoom);
}

function frameBox(box: THREE.Box3, view: ViewName, zoom = 1) {
  const { camera, controls } = three();
  const orbit = controls as unknown as OrbitControlsImpl | null;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
  const fov = ((camera as THREE.PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
  const distance = ((radius / Math.sin(fov / 2)) * 1.05) / Math.max(zoom, 0.01);

  const dir =
    view === "current"
      ? camera.position.clone().sub(orbit?.target ?? center).normalize()
      : VIEW_DIRS[view].clone().normalize();

  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  if (orbit) {
    orbit.target.copy(center);
    orbit.update();
  } else {
    camera.lookAt(center);
  }
}

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Kameraet slik det står nå (for å sette det tilbake etter et skjermbilde). */
export function cameraState(): CameraState {
  const { camera, controls } = three();
  const orbit = controls as unknown as OrbitControlsImpl | null;
  return {
    position: camera.position.clone(),
    target: orbit?.target.clone() ?? new THREE.Vector3(),
    fov: (camera as THREE.PerspectiveCamera).fov ?? 50,
  };
}

/** Kameraet i `position`, rettet mot `target` (og eventuelt med ny synsvinkel i grader). */
export function setCamera(position: Vec3, target: Vec3, fov?: number) {
  const { camera, controls } = three();
  const orbit = controls as unknown as OrbitControlsImpl | null;
  const persp = camera as THREE.PerspectiveCamera;
  camera.position.set(...position);
  if (fov !== undefined && persp.isPerspectiveCamera) persp.fov = THREE.MathUtils.clamp(fov, 5, 120);
  camera.updateProjectionMatrix();
  if (orbit) {
    orbit.target.set(...target);
    orbit.update();
  } else camera.lookAt(...target);
}

export function restoreCamera(s: CameraState) {
  setCamera(s.position.toArray() as Vec3, s.target.toArray() as Vec3, s.fov);
}

export interface RayHit {
  objectId: string;
  name: string;
  /** Treffpunktet i verdensrommet. */
  point: Vec3;
  /** Flatenormalen i treffpunktet, snudd mot strålen. */
  normal: Vec3;
  distance: number;
}

/** Hjørnenormalene interpolert i treffpunktet (glatt på kuler o.l.), i meshens lokale rom. */
function smoothNormal(h: THREE.Intersection): THREE.Vector3 | null {
  const mesh = h.object as THREE.Mesh;
  const pos = mesh.geometry?.getAttribute("position");
  const nrm = mesh.geometry?.getAttribute("normal");
  if (!h.face || !pos || !nrm) return null;
  const { a, b, c } = h.face;
  const v = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) => new THREE.Vector3().fromBufferAttribute(attr, i);
  const local = mesh.worldToLocal(h.point.clone());
  const n = THREE.Triangle.getInterpolation(local, v(pos, a), v(pos, b), v(pos, c), v(nrm, a), v(nrm, b), v(nrm, c), new THREE.Vector3());
  return n && n.lengthSq() > 1e-10 ? n.normalize() : null;
}

/**
 * Sender en stråle fra `origin` langs `direction` og finner hva den treffer – slik det vises (med hull skåret ut og
 * animasjoner tatt med). Hull, lys og noder hoppes over, og det samme gjør `ignore`.
 */
export function raycast(origin: Vec3, direction: Vec3, opts: { maxDistance?: number; ignore?: string[]; all?: boolean } = {}): RayHit[] {
  const { objects } = useEditor.getState();
  const byId = new Map(objects.map((o) => [o.id, o]));
  const ignore = new Set(opts.ignore ?? []);
  const meshes = sceneMeshes().filter((m) => {
    const o = byId.get(m.userData.lunaId as string);
    return !!o && !isHelper(o.type) && !o.hole && !ignore.has(o.id) && m.visible;
  });
  const dir = new THREE.Vector3(...direction);
  if (dir.lengthSq() < 1e-12) throw new Error("direction kan ikke være [0, 0, 0]");
  dir.normalize();
  three().scene.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), dir, 0, opts.maxDistance ?? Infinity);
  // Samme objekt og samme avstand = samme treff (en stråle gjennom et hjørne treffer alle trekantene rundt det).
  const unique = ray.intersectObjects(meshes, false).filter(
    (h, i, all) => !all.slice(0, i).some((p) => p.object === h.object && Math.abs(p.distance - h.distance) < 1e-4),
  );
  const hits = unique.map((h) => {
    const normal = smoothNormal(h) ?? h.face?.normal.clone() ?? dir.clone().negate();
    normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize();
    if (normal.dot(dir) > 0) normal.negate();
    const o = byId.get(h.object.userData.lunaId as string)!;
    return {
      objectId: o.id,
      name: o.name,
      point: h.point.toArray().map((v) => round(v)) as Vec3,
      normal: normal.toArray().map((v) => round(v)) as Vec3,
      distance: round(h.distance),
    };
  });
  return opts.all ? hits : hits.slice(0, 1);
}

/** Punktet på bakken kameraet ser mot, avrundet til rutenettet. */
export function viewTargetOnGround(): [number, number] {
  try {
    const orbit = three().controls as unknown as OrbitControlsImpl | null;
    const t = orbit?.target ?? new THREE.Vector3();
    return [Math.round(t.x * 2) / 2, Math.round(t.z * 2) / 2];
  } catch {
    return [0, 0];
  }
}

/** Flytter kameraet slik at `point` står midt i bildet, litt nærmere. */
export function focusPoint(point: THREE.Vector3, distance = 5) {
  const { camera, controls } = three();
  const orbit = controls as unknown as OrbitControlsImpl | null;
  const target = orbit?.target ?? new THREE.Vector3();
  const dir = camera.position.clone().sub(target).normalize();
  camera.position.copy(point).addScaledVector(dir, distance);
  if (orbit) {
    orbit.target.copy(point);
    orbit.update();
  } else camera.lookAt(point);
}

/** Tegner nummererte pinner inn i skjermbildet, så Claude ser dem (pinnene er DOM, ikke WebGL). */
function drawNotePins(ctx: CanvasRenderingContext2D) {
  const { notes, objects, showNotes, showResolvedNotes } = useEditor.getState();
  if (!showNotes) return;
  const { camera } = three();
  for (const note of notes) {
    if (!isVisibleNote(note, showResolvedNotes)) continue;
    const p = noteWorldPosition(note, objects).project(camera);
    if (p.z > 1) continue; // bak kameraet
    const x = ((p.x + 1) / 2) * ctx.canvas.width;
    const y = ((1 - p.y) / 2) * ctx.canvas.height;
    const r = 11;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y - 2 * r, r, Math.PI * 0.75, Math.PI * 0.25);
    ctx.closePath();
    ctx.fillStyle = note.status === "done" ? "#3a9a5b" : note.author === "claude" ? "#8b5cf6" : "#f97316";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(note.number), x, y - 2 * r);
  }
}

/**
 * Lar React (og React Three Fiber) gjøre ferdig endringene før vi tegner. MessageChannel går også i minimerte eller
 * tildekkede vinduer, der nettleseren ikke gir requestAnimationFrame.
 */
const afterCommit = () =>
  new Promise<void>((r) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => r();
    channel.port2.postMessage(null);
  });

/** Størrelsen et minimert vindu (lerret uten størrelse) tegner skjermbildet i. */
const HIDDEN_SIZE = { width: 1280, height: 800 };

/** Tar et bilde av 3D-visningen (uten utvalgs-gizmo) og returnerer base64-PNG. Virker også når vinduet er skjult. */
export async function captureViewport(maxWidth = 1024): Promise<{ base64: string; width: number; height: number }> {
  const { selectedIds, selectMany } = useEditor.getState();
  selectMany([]);
  await afterCommit();
  await afterCommit();
  const state = three();
  const restore = state.size.width && state.size.height ? null : { ...state.size };
  if (restore) state.setSize(HIDDEN_SIZE.width, HIDDEN_SIZE.height);
  try {
    // Tegn bildet selv (med useFrame-oppdateringene) i stedet for å vente på nettleserens neste bilde.
    state.advance(performance.now());
    const src = state.gl.domElement;
    const scale = Math.min(1, maxWidth / src.width);
    const out = document.createElement("canvas");
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    const ctx = out.getContext("2d")!;
    // Lerretet er gjennomsiktig (temaets gradient synes bak) – fyll med temaets bakgrunn.
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-page").trim() || "#06112a";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    drawNotePins(ctx);
    const base64 = out.toDataURL("image/png").split(",")[1];
    return { base64, width: out.width, height: out.height };
  } finally {
    if (restore) state.setSize(restore.width, restore.height);
    selectMany(selectedIds);
  }
}
