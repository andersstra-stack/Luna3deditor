// Felles for huben og stdio-proxyen. NB: stdout tilhører MCP-protokollen i proxyen – logging går til stderr.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_PORT } from "../src/bridge/protocol.ts";

export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const HUB_URL = `http://127.0.0.1:${Number(process.env.LUNA_HUB_PORT ?? HUB_PORT)}`;
export const LOG_DIR = join(homedir(), ".luna3d");
export const LOG_FILE = join(LOG_DIR, "hub.log");

export const log = (...args: unknown[]) => console.error("[luna3d-mcp]", ...args);

/**
 * Hvilken versjon av koden som kjører: versjonen + nyeste endringstid for filene huben bruker. Proxyen sammenligner
 * med huben, så en hub som kjører gammel kode byttes ut når ingen økter bruker den.
 */
export function codeStamp(): string {
  const files = [
    ...readdirSync(new URL("./", import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => new URL(`./${f}`, import.meta.url)),
    new URL("../src/bridge/protocol.ts", import.meta.url),
    new URL("../src/types.ts", import.meta.url),
  ];
  const newest = Math.max(...files.map((f) => statSync(f).mtimeMs));
  return `${VERSION}-${Math.round(newest)}`;
}
