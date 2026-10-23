import type { Folder } from "./types";

/** Mappe-id-er fra `id` og oppover mot roten (inkludert `id`). */
export function folderChain(folders: Folder[], id: string | null): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: string[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && !chain.includes(cur.id)) {
    chain.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

/** Er `id` lik eller ligger inni `ancestorId`? */
export function isInside(folders: Folder[], id: string | null, ancestorId: string): boolean {
  return folderChain(folders, id).includes(ancestorId);
}

/** Mapper som er skjult, enten selv eller fordi en overordnet mappe er skjult. */
export function hiddenFolderIds(folders: Folder[]): Set<string> {
  const hidden = new Set<string>();
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const f of folders) {
    if (folderChain(folders, f.id).some((id) => !byId.get(id)!.visible)) hidden.add(f.id);
  }
  return hidden;
}

/** "Hus / Tak / Takstein" */
export function folderPath(folders: Folder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folderChain(folders, id)
    .reverse()
    .map((fid) => byId.get(fid)!.name)
    .join(" / ");
}
