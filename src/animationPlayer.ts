// Avspilling av animasjonsklipp i editoren. Spilleren (klipp, tid, spiller/pause) er visning – ikke en del av scenen
// eller angre-historikken. Posituren regnes ut én gang per tidspunkt og leses av hver mesh i useFrame.

import * as THREE from "three";
import { create } from "zustand";
import { useEditor } from "./store";
import { makeAnimator } from "./animation";

interface PlayerState {
  /** Klippet som vises (null = hvileposisjon, slik scenen er lagret). */
  clipId: string | null;
  time: number;
  playing: boolean;
  select: (clipId: string | null) => void;
  setTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  /** Tilbake til start (og pause). */
  stop: () => void;
}

const clipOf = (id: string | null) => (id ? useEditor.getState().clips.find((c) => c.id === id) ?? null : null);

export const usePlayer = create<PlayerState>((set, get) => ({
  clipId: null,
  time: 0,
  playing: false,
  select: (clipId) => set({ clipId, time: 0, playing: false }),
  setTime: (t) => {
    const clip = clipOf(get().clipId);
    set({ time: clip ? Math.min(Math.max(0, t), clip.duration) : 0 });
  },
  play: () => {
    const clip = clipOf(get().clipId);
    if (!clip) return;
    // Spilt ferdig (uten sløyfe): start på nytt.
    set({ playing: true, ...(get().time >= clip.duration ? { time: 0 } : {}) });
  },
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, time: 0 }),
}));

/** Flytter tiden fram (kalles hver frame fra 3D-visningen). */
export function advancePlayer(dt: number) {
  const { playing, time, clipId } = usePlayer.getState();
  if (!playing) return;
  const clip = clipOf(clipId);
  if (!clip) return usePlayer.setState({ playing: false, clipId: null, time: 0 });
  let t = time + dt;
  if (t >= clip.duration) {
    if (clip.loop) t %= clip.duration;
    else return usePlayer.setState({ time: clip.duration, playing: false });
  }
  usePlayer.setState({ time: t });
}

let cache: {
  clip: unknown;
  objects: unknown;
  folders: unknown;
  animator: ReturnType<typeof makeAnimator>;
  time: number;
  pose: Map<string, THREE.Matrix4>;
} | null = null;

/** Verdensmatrisene til det som beveger seg i det valgte klippet nå (null = alt står i hvileposisjon). */
export function currentPose(): Map<string, THREE.Matrix4> | null {
  const { clipId, time } = usePlayer.getState();
  const clip = clipOf(clipId);
  if (!clip) return null;
  const { objects, folders } = useEditor.getState();
  if (!cache || cache.clip !== clip || cache.objects !== objects || cache.folders !== folders) {
    cache = { clip, objects, folders, animator: makeAnimator(clip, objects, folders), time: NaN, pose: new Map() };
  }
  if (cache.time !== time) {
    cache.pose = cache.animator.poseAt(time);
    cache.time = time;
  }
  return cache.pose;
}
