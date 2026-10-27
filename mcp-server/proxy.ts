/**
 * Stdio-proxyen Claude Code starter (`node mcp-server/index.ts`). Den starter huben hvis den ikke kjører, og sender
 * MCP-meldingene videre til den over HTTP – én hub-økt per Claude-økt, så flere økter kan jobbe samtidig. Dør huben,
 * startes den på nytt og handshaken gjentas uten at Claude Code merker det.
 *
 * LUNA3D_PROJECT=<prosjekt-id> låser økta til ett prosjekt (adressen /mcp/<id>).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isInitializeRequest, isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { HUB_URL, LOG_FILE, REPO_ROOT, codeStamp, log } from "./common.ts";

const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
const REPLAY_ID = "luna3d-proxy-reinit";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Health {
  app: string;
  stamp: string;
  live: number;
}

async function health(): Promise<Health | null> {
  try {
    const res = await fetch(`${HUB_URL}/health`, { signal: AbortSignal.timeout(1500) });
    const h = (await res.json()) as Health;
    return h?.app === "luna3d-hub" ? h : null;
  } catch {
    return null;
  }
}

/** Sørger for at huben kjører med samme kode som proxyen (bytter den ut hvis ingen økter bruker den). */
async function ensureHub() {
  let h = await health();
  if (h && h.stamp !== codeStamp()) {
    if (h.live === 0) {
      log("huben kjører eldre kode – starter den på nytt");
      await fetch(`${HUB_URL}/shutdown`, { method: "POST" }).catch(() => {});
      for (let i = 0; i < 20 && (await health()); i++) await sleep(150);
      h = null;
    } else {
      log("huben kjører eldre kode, men andre økter bruker den – den byttes ut når de er ferdige");
    }
  }
  if (h) return;
  spawn(process.execPath, [ENTRY, "--hub"], { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    if (await health()) return;
  }
  throw new Error(`Luna 3D-huben startet ikke – se ${LOG_FILE}`);
}

export async function runProxy() {
  const project = process.env.LUNA3D_PROJECT?.trim();
  const url = new URL(`${HUB_URL}/mcp${project ? `/${encodeURIComponent(project)}` : ""}`);
  const stdio = new StdioServerTransport();
  let http: StreamableHTTPClientTransport | null = null;
  let initRequest: JSONRPCMessage | null = null;
  let initialized = false;
  let reinitDone: (() => void) | null = null;
  let reconnecting: Promise<void> | null = null;

  const connect = async () => {
    await ensureHub();
    const t = new StreamableHTTPClientTransport(url);
    t.onmessage = (msg) => {
      if ("id" in msg && msg.id === REPLAY_ID) return reinitDone?.();
      stdio.send(msg).catch((e) => log("stdio:", (e as Error).message));
    };
    t.onerror = (e) => log("hub:", e.message);
    await t.start();
    http = t;
  };

  /** Ny forbindelse (og ny hub-økt). Var økta allerede i gang, gjentas handshaken. */
  const reconnect = () =>
    (reconnecting ??= (async () => {
      const old = http;
      http = null;
      await old?.close().catch(() => {});
      await connect();
      if (initRequest && initialized) {
        const done = new Promise<void>((r) => (reinitDone = r));
        await http!.send({ ...initRequest, id: REPLAY_ID } as JSONRPCMessage);
        await Promise.race([done, sleep(5000)]);
        await http!.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        log("koblet til huben på nytt");
      }
    })().finally(() => (reconnecting = null)));

  stdio.onmessage = async (msg) => {
    if (isInitializeRequest(msg)) initRequest = msg;
    try {
      if (!http) await reconnect();
      await http!.send(msg);
      if (!("id" in msg) && msg.method === "notifications/initialized") initialized = true;
    } catch (first) {
      try {
        log("huben svarte ikke:", (first as Error).message);
        await reconnect();
        await http!.send(msg);
      } catch (e) {
        if (isJSONRPCRequest(msg)) {
          const error = { code: -32603, message: `Luna 3D-huben svarer ikke: ${(e as Error).message}` };
          await stdio.send({ jsonrpc: "2.0", id: msg.id, error }).catch(() => {});
        }
      }
    }
  };

  // Avslutt hub-økta når Claude Code lukker forbindelsen.
  const quit = async () => {
    await Promise.race([http?.terminateSession().catch(() => {}), sleep(1000)]);
    process.exit(0);
  };
  stdio.onclose = quit;
  process.stdin.on("end", quit);

  await stdio.start();
  reconnect().catch((e) => log((e as Error).message));
}
