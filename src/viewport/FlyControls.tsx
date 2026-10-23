// Fri flyging som i Unitys scenevisning: hold høyre musknapp for å se deg rundt, og fly med
// W/A/S/D (fram/sidelengs), Q/E (ned/opp) og Shift (fortere). Hjulet endrer farten mens du flyr.
// Banekontrollen (OrbitControls) er av så lenge, og får nytt midtpunkt foran kameraet etterpå.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/** Tast (KeyboardEvent.code) → retning: x/z i kameraets rom, y i verdensrommet. */
const MOVE: Record<string, [number, number, number]> = {
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyQ: [0, -1, 0],
  KeyE: [0, 1, 0],
};
const LOOK_SPEED = 0.0025; // radianer per piksel
const FAST = 4;

let flying = false;
/** Om brukeren flyr akkurat nå (høyre musknapp holdt nede i 3D-visningen). */
export const isFlying = () => flying;

export function FlyControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const fly = useRef({ keys: new Set<string>(), fast: false, speed: 10, distance: 10 });

  useEffect(() => {
    const el = gl.domElement;
    const s = fly.current;
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    const start = (e: PointerEvent) => {
      if (e.button !== 2 || !controls) return;
      flying = true;
      s.distance = Math.max(1, camera.position.distanceTo(controls.target));
      // Farten følger hvor langt unna du ser: en stol og en 800 m lang hangar skal begge føles greie.
      s.speed = Math.max(3, s.distance * 0.6);
      controls.enabled = false;
      try {
        el.setPointerCapture(e.pointerId); // så slippet registreres også utenfor vinduet
      } catch {
        // syntetiske hendelser (tester) har ingen aktiv peker
      }
    };
    const look = (e: PointerEvent) => {
      if (!flying) return;
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= e.movementX * LOOK_SPEED;
      euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * LOOK_SPEED, -1.55, 1.55);
      euler.z = 0;
      camera.quaternion.setFromEuler(euler);
    };
    const stop = () => {
      if (!flying) return;
      flying = false;
      s.keys.clear();
      if (!controls) return;
      // Banekontrollen dreier videre rundt et punkt like langt foran kameraet som før.
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(s.distance);
      controls.target.copy(camera.position).add(ahead);
      controls.enabled = true;
      controls.update();
    };
    const end = (e: PointerEvent) => e.button === 2 && stop();
    // Fanges før App sine snarveier (W/E/R er flytt/roter/skaler), men bare mens du flyr.
    const key = (e: KeyboardEvent) => {
      if (!flying) return;
      s.fast = e.shiftKey;
      if (!(e.code in MOVE) && e.key !== "Shift") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code in MOVE) {
        if (e.type === "keydown") s.keys.add(e.code);
        else s.keys.delete(e.code);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!flying) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      s.speed = THREE.MathUtils.clamp(s.speed * (e.deltaY < 0 ? 1.25 : 0.8), 0.5, 5000);
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();

    el.addEventListener("pointerdown", start, true);
    el.addEventListener("pointermove", look);
    el.addEventListener("pointerup", end);
    el.addEventListener("lostpointercapture", stop);
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    el.addEventListener("contextmenu", noMenu);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      el.removeEventListener("pointerdown", start, true);
      el.removeEventListener("pointermove", look);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("lostpointercapture", stop);
      el.removeEventListener("wheel", wheel, { capture: true });
      el.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", stop);
    };
  }, [camera, gl, controls]);

  const move = new THREE.Vector3();
  useFrame((_, delta) => {
    const s = fly.current;
    if (!flying || !s.keys.size) return;
    const local = new THREE.Vector3();
    let up = 0;
    for (const code of s.keys) {
      const [x, y, z] = MOVE[code];
      local.x += x;
      local.z += z;
      up += y;
    }
    move.copy(local).applyQuaternion(camera.quaternion);
    move.y += up;
    if (move.lengthSq() === 0) return;
    // delta kappes, så et hakk i bildeflyten ikke kaster kameraet langt av gårde.
    camera.position.addScaledVector(move.normalize(), s.speed * (s.fast ? FAST : 1) * Math.min(delta, 0.1));
  });

  return null;
}
