// Leser bildefiler for add_objects (texture, normal_map, roughness_map). Appen får innholdet, ikke filstien.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface ImageInput {
  id: string;
  mime?: string;
  data?: string;
}

function mimeOf(bytes: Buffer, path: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  throw new Error(`${path} er ikke PNG eller JPEG (det eneste glTF-eksporten støtter)`);
}

/** Bytt ut filstier med bildeinnhold. Samme fil i flere objekter sendes bare én gang; senere bruk har bare id-en. */
export function withImages<T extends { texture?: string; normal_map?: string; roughness_map?: string }>(
  objects: T[],
): (Omit<T, "texture" | "normal_map" | "roughness_map"> & { texture?: ImageInput; normal_map?: ImageInput; roughness_map?: ImageInput })[] {
  const ids = new Map<string, string>();
  const image = (path: string): ImageInput => {
    const seen = ids.get(path);
    if (seen) return { id: seen };
    const bytes = readFileSync(path);
    const id = `tex_${createHash("sha1").update(bytes).digest("hex").slice(0, 20)}`;
    ids.set(path, id);
    return { id, mime: mimeOf(bytes, path), data: bytes.toString("base64") };
  };
  return objects.map(({ texture, normal_map, roughness_map, ...rest }) => ({
    ...rest,
    ...(texture !== undefined ? { texture: image(texture) } : {}),
    ...(normal_map !== undefined ? { normal_map: image(normal_map) } : {}),
    ...(roughness_map !== undefined ? { roughness_map: image(roughness_map) } : {}),
  }));
}
