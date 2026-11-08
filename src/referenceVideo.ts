// Referansevideo: en filmsnutt å animere etter, som et referansebilde, men den følger tidslinja – tiden i videoen er
// `videoOffset + videoRate · klippets tid`. Videoen lenkes (bare stien lagres i scenen), leses fra disk via Tauri og
// spilles fra en blob-URL. Skjermbilder venter til videoen har funnet riktig bilde (`settleVideos`), så det Claude ser av
// videoen og figuren alltid er samme øyeblikk.

import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";

export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v"];
export const isVideoPath = (path: string) => VIDEO_EXTENSIONS.includes(path.toLowerCase().split(".").pop() ?? "");

const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

interface LoadedVideo {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  width: number;
  height: number;
  duration: number;
}

const loaded = new Map<string, Promise<LoadedVideo>>();
/** Videoer som lastes inn nå – skjermbilder venter på dem (settleVideos). */
const pending = new Set<Promise<unknown>>();
const ready = new Map<string, LoadedVideo>();
const pathKey = (path: string) => path.replace(/[\\/]+/g, "/").toLowerCase();

/** Leser videoen (én gang per fil) og venter til målene og lengden er kjent. */
export function loadVideo(path: string): Promise<LoadedVideo> {
  const key = pathKey(path);
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      // I en vanlig nettleser (testing uten Tauri) hentes fila over HTTP, f.eks. fra Vite.
      const data = "__TAURI_INTERNALS__" in window ? await invoke<ArrayBuffer>("read_binary_file", { path }) : await (await fetch(path)).arrayBuffer();
      const ext = path.toLowerCase().split(".").pop() ?? "";
      const url = URL.createObjectURL(new Blob([data], { type: MIME[ext] ?? "video/mp4" }));
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`Kunne ikke spille ${path} – bruk MP4 (H.264) eller WebM`));
      });
      // Opptak (MediaRecorder, skjermopptak) mangler ofte lengden i fila: spol til slutten så nettleseren finner den.
      if (!Number.isFinite(video.duration)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            video.removeEventListener("durationchange", check);
            resolve();
          };
          const check = () => Number.isFinite(video.duration) && done();
          video.addEventListener("durationchange", check);
          video.currentTime = 1e7;
          setTimeout(done, 3000);
        });
        video.currentTime = 0;
      }
      // VideoTexture, ikke Texture: en vanlig tekstur lagres én gang med elementets width/height (0 for <video>) og blir svart.
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      // Referanseplanet har UV med v = 0 øverst (som bildene i teksturregisteret).
      texture.flipY = false;
      texture.needsUpdate = true;
      const v: LoadedVideo = { video, texture, width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 };
      ready.set(key, v);
      return v;
    })();
    loaded.set(key, p);
    const settled = p.catch(() => loaded.delete(key)).finally(() => pending.delete(settled));
    // En fil som ikke kunne leses, prøves på nytt neste gang.
    pending.add(settled);
  }
  return p;
}

/** Videoen hvis den er lest inn (ellers null – visningen viser et tomt plan til den er klar). */
export const videoIfReady = (path: string) => ready.get(pathKey(path)) ?? null;

/** Bredde/høyde for en video som er lest inn, eller null. */
export function videoAspect(path: string): number | null {
  const v = videoIfReady(path);
  return v && v.width && v.height ? v.width / v.height : null;
}

/** Tiden i videoen for et referanseobjekt ved klippets tid t, innenfor videoens lengde. */
export function videoTime(v: LoadedVideo, t: number, offset = 0, rate = 1): number {
  const time = offset + rate * t;
  // Ukjent lengde (0): ingen øvre grense.
  return v.duration > 0 ? Math.min(Math.max(0, time), v.duration - 0.001) : Math.max(0, time);
}

/** Videoene som vises nå, og tiden hver skal stå på (registreres av visningen hvert bilde). */
const active = new Map<HTMLVideoElement, { target: () => number; texture: THREE.Texture }>();

export function trackVideo(v: LoadedVideo, target: () => number): () => void {
  active.set(v.video, { target, texture: v.texture });
  return () => active.delete(v.video);
}

/**
 * Holder videoen i takt med tidslinja: under avspilling spiller den med (rettes når den driver), ellers står den stille på
 * riktig bilde. Kalles hvert bilde fra visningen.
 */
export function syncVideo(v: LoadedVideo, time: number, playing: boolean, rate: number) {
  const { video } = v;
  if (playing) {
    if (video.playbackRate !== rate && rate > 0) video.playbackRate = rate;
    if (video.paused && rate > 0) {
      video.currentTime = time;
      void video.play().catch(() => {});
    } else if (Math.abs(video.currentTime - time) > 0.15) {
      video.currentTime = time;
    }
  } else {
    if (!video.paused) video.pause();
    if (!video.seeking && Math.abs(video.currentTime - time) > 0.004) video.currentTime = time;
  }
  if (video.readyState >= 2) v.texture.needsUpdate = true;
}

/**
 * Venter til alle synlige videoer står på riktig bilde (før skjermbilder): spoler, venter på «seeked» og sjekker at tiden
 * faktisk stemmer – en eldre spoling som blir ferdig underveis, gir ellers feil bilde. Gir opp etter `timeoutMs`.
 */
export async function settleVideos(timeoutMs = 3000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  // En video som nettopp er lagt inn eller byttet, lastes kanskje fortsatt: vent på den, og på at visningen har tatt den i bruk.
  if (pending.size) {
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
    await new Promise((r) => setTimeout(r, 60));
  }
  const settle = async (video: HTMLVideoElement, target: () => number, texture: THREE.Texture) => {
    if (!video.paused) video.pause();
    const t = target();
    while (performance.now() < deadline) {
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - t) <= 0.004) break;
      await new Promise<void>((resolve) => {
        const finish = () => {
          video.removeEventListener("seeked", finish);
          resolve();
        };
        video.addEventListener("seeked", finish);
        if (!video.seeking) video.currentTime = t;
        setTimeout(finish, Math.max(0, Math.min(1000, deadline - performance.now())));
      });
    }
    texture.needsUpdate = true;
  };
  await Promise.all([...active].map(([video, { target, texture }]) => settle(video, target, texture)));
}
