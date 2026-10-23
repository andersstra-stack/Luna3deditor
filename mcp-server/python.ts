// Kjører Python-skript for MCP-verktøyet run_python: `python -m luna3d skript.py` med
// scenen som JSON-fil inn, og skriptets endringer (etter en markør) i stdout ut.
// Samme oppsett som appens Rust-kommando run_python_script.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTING_DIR = fileURLToPath(new URL("../scripting/", import.meta.url));
const MARKER = "@@LUNA3D_OPS@@";
const TIMEOUT_MS = 60_000;

export interface PythonRun {
  ops: unknown[] | null;
  printed: string;
  stderr: string;
  code: number | null;
}

const candidates = (): [string, string[]][] =>
  process.env.LUNA_PYTHON ? [[process.env.LUNA_PYTHON, []]] : [["python", []], ["py", ["-3"]], ["python3", []]];

function runOnce(exe: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nAvbrutt: skriptet brukte mer enn ${TIMEOUT_MS / 1000} sekunder.`;
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Kjører skriptet på `scriptPath` med `scene` tilgjengelig som luna3d.scene. */
export async function runPythonScript(scriptPath: string, scene: unknown): Promise<PythonRun> {
  const tmp = mkdtempSync(join(tmpdir(), "luna3d-"));
  const sceneFile = join(tmp, "scene.json");
  writeFileSync(sceneFile, JSON.stringify(scene));
  const env = {
    ...process.env,
    PYTHONPATH: SCRIPTING_DIR,
    PYTHONIOENCODING: "utf-8",
    LUNA3D_SCENE_FILE: sceneFile,
  };
  try {
    let lastError: unknown = null;
    for (const [exe, pre] of candidates()) {
      try {
        const out = await runOnce(exe, [...pre, "-m", "luna3d", scriptPath], env);
        const at = out.stdout.lastIndexOf(MARKER);
        const ops = at >= 0 && out.code === 0 ? (JSON.parse(out.stdout.slice(at + MARKER.length)).ops as unknown[]) : null;
        return { ops, printed: (at >= 0 ? out.stdout.slice(0, at) : out.stdout).trim(), stderr: out.stderr.trim(), code: out.code };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        lastError = err;
      }
    }
    throw new Error(`Fant ikke Python (${(lastError as Error)?.message}). Installer Python 3 eller sett LUNA_PYTHON.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
