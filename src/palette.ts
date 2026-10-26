// Palett-tekstur som i Nova-biblioteket: hver farge (med sin glød) får én piksel i et lite bilde
// (8×8, eller større når det trengs), og alle hjørnene i en del peker på sin piksel. Da kan en hel
// modell dele ett materiale. Gløden blir et eget bilde (`_emission`) med samme ruter.

import * as THREE from "three";
import { round } from "./bounds";

export interface Palette {
  /** Antall ruter per side (8, 16, 32 …). */
  size: number;
  colors: number;
  /** UV-en til ruta for en farge med en glød (glTF: v = 0 øverst). */
  uvOf: (color: string, emissive?: number) => [number, number];
  map: THREE.CanvasTexture;
  /** Bare når minst én farge gløder. */
  emissive: THREE.CanvasTexture | null;
  /** Bildene som PNG, til filer ved siden av GLB-en. */
  png: () => Promise<{ palette: Uint8Array; emission: Uint8Array | null }>;
}

/** Én rute i paletten: en farge og hvor mye den gløder. */
export interface PaletteCell {
  color: string;
  emissive?: number;
}

const cellKey = (color: string, emissive = 0) => `${color.toLowerCase()}|${round(emissive, 0.01)}`;

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  // UV-ene regnes med v = 0 øverst (som i glTF), så bildet skal ikke snus.
  t.flipY = false;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Kunne ikke lage PNG av paletten");
  return new Uint8Array(await blob.arrayBuffer());
}

export function buildPalette(cells: PaletteCell[]): Palette {
  const keys = [...new Set(cells.map((c) => cellKey(c.color, c.emissive)))];
  let size = 8;
  while (size * size < keys.length) size *= 2;

  const make = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    return { c, ctx };
  };
  const base = make();
  const glow = make();
  const cell = new Map<string, [number, number]>();
  let anyGlow = false;
  keys.forEach((key, i) => {
    const [hex, g] = key.split("|");
    const x = i % size;
    const y = Math.floor(i / size);
    cell.set(key, [x, y]);
    base.ctx.fillStyle = hex;
    base.ctx.fillRect(x, y, 1, 1);
    const strength = Number(g);
    if (strength > 0) {
      anyGlow = true;
      // Gløden skaleres i lineært rom, så halv glød er halvt så mye lys.
      glow.ctx.fillStyle = `#${new THREE.Color(hex).multiplyScalar(strength).getHexString()}`;
      glow.ctx.fillRect(x, y, 1, 1);
    }
  });

  return {
    size,
    colors: keys.length,
    uvOf: (color, emissive) => {
      const [x, y] = cell.get(cellKey(color, emissive)) ?? [0, 0];
      return [(x + 0.5) / size, (y + 0.5) / size];
    },
    map: texture(base.c),
    emissive: anyGlow ? texture(glow.c) : null,
    png: async () => ({ palette: await pngBytes(base.c), emission: anyGlow ? await pngBytes(glow.c) : null }),
  };
}
