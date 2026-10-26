// Python-skript: scripting/luna3d.py samler endringer og skriver dem ut etter en markør
// når skriptet er ferdig. Her tolkes utdataene og brukes på scenen som ett angre-steg.
// Skript kjøres enten fra appen (Rust: run_python_script) eller av MCP-verktøyet run_python.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditor } from "./store";
import { objectBox, round } from "./bounds";
import { isNode, type ScriptOp, type ScriptResult } from "./types";
import { nodeAxes } from "./nodes";
import { curveWorldPoints } from "./curves";

export const SCRIPT_MARKER = "@@LUNA3D_OPS@@";

/** Scenen slik skript ser den (også med nøyaktige omsluttende bokser). Samme som MCP get_scene. */
export function sceneForScripts() {
  const { objects, folders, selectedIds, filePath, clips } = useEditor.getState();
  const withBounds = objects.map((o) => {
    const b = objectBox(o);
    const bounds = { min: b.min.toArray().map((v) => round(v)), max: b.max.toArray().map((v) => round(v)) };
    // Noder: retningene i verdensrommet (lokal +Z forover, +Y opp), så Claude slipper å regne på Euler-vinkler.
    if (isNode(o.type)) return { ...o, bounds, ...nodeAxes(o) };
    // Kurverør: punktene i verdensrommet (samme form som de oppgis i), ikke de lokale.
    if (o.type === "curve" && o.curve) {
      const { curve, ...rest } = o;
      return { ...rest, points: curveWorldPoints(o), radius: curve.radius, bounds };
    }
    return { ...o, bounds };
  });
  return { folders, objects: withBounds, clips, selectedIds, filePath };
}

/** Skiller skriptets egne utskrifter fra endringene. Endringene er null hvis skriptet ikke fullførte. */
export function parseScriptOutput(stdout: string): { ops: ScriptOp[] | null; printed: string } {
  const at = stdout.lastIndexOf(SCRIPT_MARKER);
  if (at < 0) return { ops: null, printed: stdout.trim() };
  const data = JSON.parse(stdout.slice(at + SCRIPT_MARKER.length)) as { format?: string; ops?: ScriptOp[] };
  if (data.format !== "luna3d/script-ops" || !Array.isArray(data.ops)) throw new Error("Ukjent utdataformat fra skriptet");
  return { ops: data.ops, printed: stdout.slice(0, at).trim() };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Samme skript skal gjenkjennes uansett skråstreker og store/små bokstaver (Windows). */
export const scriptKey = (path: string) => path.replace(/[\\/]+/g, "/").toLowerCase();

export function describeResult(r: ScriptResult): string {
  const parts = [
    r.replaced && `erstattet ${plural(r.replaced, "objekt", "objekter")}`,
    r.created.length && `la til ${plural(r.created.length, "objekt", "objekter")}`,
    r.folders.length && plural(r.folders.length, "mappe", "mapper"),
    r.updated && `endret ${r.updated}`,
    r.deleted && `slettet ${r.deleted}`,
    r.animated && `${plural(r.animated, "animasjon", "animasjoner")}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "ingen endringer";
}

/**
 * Bruker skriptets endringer på scenen (ett angre-steg). Med `scriptPath` merkes det nye
 * med skriptet, og resultatet fra forrige kjøring av samme skript erstattes.
 */
export function applyScriptOps(ops: ScriptOp[], name = "skript", scriptPath?: string): ScriptResult {
  const result = useEditor.getState().applyScript(ops, scriptPath ? scriptKey(scriptPath) : undefined);
  useEditor.getState().setActivity(`${name}: ${describeResult(result)}`);
  return result;
}

interface ScriptOutput {
  stdout: string;
  stderr: string;
  code: number;
}

/** Kjører en .py-fil fra disk (fildialog uten sti) og bruker resultatet. */
export async function runPythonScriptFile(path?: string) {
  let target = path ?? null;
  if (!target) {
    const picked = await open({ filters: [{ name: "Python-skript", extensions: ["py"] }], multiple: false });
    target = typeof picked === "string" ? picked : null;
  }
  if (!target) return null;
  const name = target.split(/[\\/]/).pop()!;

  const out = await invoke<ScriptOutput>("run_python_script", { path: target, sceneJson: JSON.stringify(sceneForScripts()) });
  const { ops, printed } = parseScriptOutput(out.stdout);
  if (printed) console.info(`[${name}]`, printed);
  if (out.code !== 0 || !ops) {
    // Siste linje i tracebacken er som regel selve feilen.
    const reason = out.stderr.trim().split(/\r?\n/).pop() || `avsluttet med kode ${out.code}`;
    throw new Error(`${name}: ${reason}`);
  }
  return applyScriptOps(ops, name, target);
}
