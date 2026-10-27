/**
 * Luna 3D-huben: én langlevende prosess som eier WebSocket-porten appvinduene kobler seg til, og som tar imot
 * MCP-økter over Streamable HTTP (http://127.0.0.1:47318/mcp). Hvert vindu er ett prosjekt. Hver økt jobber mot sitt
 * eget vindu: valgt med use_project/open_project, automatisk når bare ett er åpent, eller låst av adressen
 * (/mcp/<prosjekt-id>). Kall til samme vindu kjøres ett om gangen; ulike vinduer kjører samtidig.
 *
 * Startes av stdio-proxyen (index.ts uten --hub) når den ikke kjører, og avslutter seg selv når ingen økter har
 * brukt den på en stund. Logger til ~/.luna3d/hub.log.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from "ws";
import { BRIDGE_PORT, type BridgeMethod, type BridgeResponse, type BridgeStatusMessage } from "../src/bridge/protocol.ts";
import { HUB_URL, LOG_DIR, LOG_FILE, VERSION, codeStamp } from "./common.ts";

const WS_PORT = Number(process.env.LUNA_BRIDGE_PORT ?? BRIDGE_PORT);
const LISTEN_RETRY_MS = 3000;
/** En økt regnes som i bruk så lenge den har en åpen strøm, eller har gjort noe nylig. */
const LIVE_MS = 5 * 60_000;
/** Økter uten strøm og uten kall så lenge ryddes bort (proxyen ble trolig drept). */
const STALE_MS = 60 * 60_000;
/** Huben avslutter når ingen økter har vært i bruk så lenge. */
const IDLE_EXIT_MS = 10 * 60_000;
const OPEN_WINDOW_TIMEOUT_MS = 30_000;
const MAX_LOG_BYTES = 2_000_000;

// Kun appen (dev-server eller bygget Tauri-app) får koble til – ikke tilfeldige nettsider.
const ALLOWED_ORIGINS = new Set(["http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);

const NOT_CONNECTED = "Luna 3D-appen er ikke tilkoblet. Be brukeren starte den (`npm run tauri dev` i prosjektmappa) og prøv igjen.";

function hubLog(...args: unknown[]) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  console.error(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Loggen er til hjelp, ikke kritisk.
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Ett appvindu (ett prosjekt) koblet til over WebSocket. */
class AppWindow {
  label: string;
  file: string | null = null;
  version = "?";
  readonly connectedAt = Date.now();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  readonly socket: WebSocket;

  constructor(socket: WebSocket, label: string) {
    this.socket = socket;
    this.label = label;
  }

  /** Kall til samme vindu settes i kø, så to økter aldri kjører handlere i samme vindu samtidig. */
  call(method: BridgeMethod, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    const send = () => this.send(method, params, timeoutMs);
    const result = this.queue.then(send, send);
    this.queue = result.catch(() => {});
    return result;
  }

  private send(method: BridgeMethod, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Luna 3D-vinduet er lukket"));
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tidsavbrudd: appen svarte ikke på ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onResponse(msg: BridgeResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  failAll(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

export interface Session {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** Prosjekt-id fra adressen (/mcp/<id>): økta kan ikke bytte prosjekt. */
  pinned: string | null;
  /** Vinduet økta har valgt (Tauri-etikett). */
  window: string | null;
  /** Åpne GET-strømmer – proxyen holder én åpen så lenge Claude-økta lever. */
  streams: number;
  lastActivity: number;
}

type ToolHandler = (...args: any[]) => unknown;
export interface ToolDef {
  name: string;
  config: unknown;
  handler: ToolHandler;
}

const sessionScope = new AsyncLocalStorage<Session>();
let current: Hub | null = null;

/** Økta og huben for verktøykallet som kjører nå. */
export function currentCall(): { hub: Hub; session: Session } {
  const session = sessionScope.getStore();
  if (!current || !session) throw new Error("Ingen MCP-økt");
  return { hub: current, session };
}

/** Brukes av verktøyene: sender kallet til vinduet økta jobber i. */
export const bridge = {
  call(method: BridgeMethod, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<any> {
    try {
      const { hub, session } = currentCall();
      return hub.windowFor(session).call(method, params, timeoutMs);
    } catch (e) {
      return Promise.reject(e);
    }
  },
};

/** Prosjekt-id fra filnavnet: «Romskip Mk2.luna.json» → «romskip-mk2». */
function slug(file: string | null): string {
  if (!file) return "ulagret";
  const base = file.split(/[\\/]/).pop()!.replace(/(\.luna)?\.json$/i, "");
  const id = base
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "prosjekt";
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+/g, "/").toLowerCase() === b.replace(/[\\/]+/g, "/").toLowerCase();

export class Hub {
  windows: AppWindow[] = [];
  sessions = new Map<string, Session>();
  wsError: string | null = null;
  private stamp = codeStamp();
  private lastLive = Date.now();
  private unnamed = 0;

  private tools: ToolDef[];
  private instructions: string;

  constructor(tools: ToolDef[], instructions: string) {
    this.tools = tools;
    this.instructions = instructions;
  }

  start() {
    current = this;
    mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) renameSync(LOG_FILE, LOG_FILE.replace(/\.log$/, ".old.log"));
    const port = Number(new URL(HUB_URL).port);
    const http = createServer((req, res) => {
      this.handleHttp(req, res).catch((e) => {
        hubLog("HTTP-feil:", (e as Error).message);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    http.on("error", (err: NodeJS.ErrnoException) => {
      // To proxyer kan starte hver sin hub samtidig – den som taper, går stille ut.
      if (err.code === "EADDRINUSE") process.exit(0);
      hubLog("kunne ikke starte HTTP:", err.message);
      process.exit(1);
    });
    http.listen(port, "127.0.0.1", () => {
      hubLog(`hub ${this.stamp} (pid ${process.pid}) på ${HUB_URL}/mcp`);
      this.listenWs();
    });
    setInterval(() => this.housekeeping(), 60_000).unref();
  }

  // ---------- Appvinduene (WebSocket) ----------

  private listenWs() {
    const wss = new WebSocketServer({
      host: "127.0.0.1",
      port: WS_PORT,
      verifyClient: ({ origin }: { origin?: string }) => !origin || ALLOWED_ORIGINS.has(origin),
    });
    wss.on("listening", () => {
      this.wsError = null;
      hubLog(`venter på Luna 3D-vinduer på ws://127.0.0.1:${WS_PORT}`);
    });
    wss.on("error", (err: NodeJS.ErrnoException) => {
      const busy = err.code === "EADDRINUSE";
      const error = busy
        ? `Port ${WS_PORT} er opptatt – trolig av en eldre Luna 3D-MCP-server i en Claude-økt som ble startet før huben. Start den økta på nytt (eller /mcp → reconnect). Prøver igjen av seg selv.`
        : `Kunne ikke starte broen: ${err.message}`;
      if (error !== this.wsError) hubLog(error);
      this.wsError = error;
      if (busy) {
        wss.close();
        setTimeout(() => this.listenWs(), LISTEN_RETRY_MS).unref();
      }
    });
    wss.on("connection", (ws) => {
      const win = new AppWindow(ws, `vindu-${++this.unnamed}`);
      this.windows.push(win);
      ws.on("message", (data) => this.onWindowMessage(win, String(data)));
      ws.on("close", () => {
        const i = this.windows.indexOf(win);
        if (i < 0) return;
        this.windows.splice(i, 1);
        hubLog(`vindu ${win.label} koblet fra`);
        win.failAll("Luna 3D-vinduet koblet fra før svaret kom");
        this.pushStatus();
      });
    });
  }

  private onWindowMessage(win: AppWindow, raw: string) {
    let msg: BridgeResponse | { type: string; window?: string; file?: string | null; version?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return hubLog("ugyldig melding fra appen");
    }
    if (!("type" in msg)) return win.onResponse(msg);
    if (msg.type === "hello") {
      // Et vindu som lastes på nytt, kobler til med samme etikett før den gamle koblingen er lukket.
      if (msg.window) {
        for (const old of this.windows.filter((w) => w !== win && w.label === msg.window)) old.socket.close();
        win.label = msg.window;
      }
      win.version = msg.version ?? "?";
      win.file = msg.file ?? null;
      hubLog(`vindu ${win.label} koblet til (${win.file ?? "ulagret"}, app ${win.version})`);
    } else if (msg.type === "project") {
      win.file = msg.file ?? null;
      hubLog(`vindu ${win.label} har nå ${win.file ?? "ulagret scene"}`);
    }
    this.pushStatus();
  }

  /** Prosjekt-id per vindu (filnavnet; like navn nummereres i rekkefølgen vinduene koblet til). */
  projectIds(): Map<AppWindow, string> {
    const ids = new Map<AppWindow, string>();
    const seen = new Map<string, number>();
    for (const w of [...this.windows].sort((a, b) => a.connectedAt - b.connectedAt)) {
      const base = slug(w.file);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      ids.set(w, n === 1 ? base : `${base}-${n}`);
    }
    return ids;
  }

  private describe(ids = this.projectIds()) {
    return this.windows.map((w) => `${ids.get(w)} (${w.file ?? "ulagret"})`).join(", ") || "ingen";
  }

  /** Vinduet økta jobber i nå, uten å velge noe. */
  peek(s: Session, ids = this.projectIds()): AppWindow | null {
    if (s.pinned) return [...ids].find(([, id]) => id === s.pinned)?.[0] ?? null;
    if (s.window) return this.windows.find((w) => w.label === s.window) ?? null;
    return null;
  }

  /** Vinduet et verktøykall skal til. Er bare ett vindu åpent, velges det. */
  windowFor(s: Session): AppWindow {
    if (this.wsError && !this.windows.length) throw new Error(this.wsError);
    const ids = this.projectIds();
    const win = this.peek(s, ids);
    if (win) return win;
    if (s.pinned) throw new Error(`Prosjektet «${s.pinned}» er ikke åpent i Luna 3D. Åpne: ${this.describe(ids)}. Bruk open_project med scenefila.`);
    if (s.window) throw new Error(`Vinduet denne økta jobbet i er lukket. Åpne prosjekter: ${this.describe(ids)}. Velg med use_project eller open_project.`);
    if (!this.windows.length) throw new Error(NOT_CONNECTED);
    if (this.windows.length > 1) {
      throw new Error(`Luna 3D har ${this.windows.length} prosjekter åpne: ${this.describe(ids)}. Velg ett med use_project (eller open_project) først.`);
    }
    s.window = this.windows[0].label;
    hubLog(`${this.who(s)} bruker ${ids.get(this.windows[0])} (eneste vindu)`);
    this.pushStatus();
    return this.windows[0];
  }

  private live(s: Session) {
    return s.streams > 0 || Date.now() - s.lastActivity < LIVE_MS;
  }

  private sessionsOn(win: AppWindow, ids: Map<AppWindow, string>) {
    return [...this.sessions.values()].filter((s) => this.live(s) && this.peek(s, ids) === win);
  }

  /** Forteller hvert vindu hvilken prosjekt-id det har og hvor mange økter som jobber i det. */
  pushStatus() {
    const ids = this.projectIds();
    for (const w of this.windows) {
      if (w.socket.readyState !== WebSocket.OPEN) continue;
      const msg: BridgeStatusMessage = { type: "status", project: ids.get(w)!, sessions: this.sessionsOn(w, ids).length };
      w.socket.send(JSON.stringify(msg));
    }
  }

  private who(s: Session) {
    const client = s.server.server.getClientVersion()?.name ?? "?";
    return `[${s.id.slice(0, 8)} ${client}]`;
  }

  // ---------- Prosjektverktøyene ----------

  listProjects(s: Session) {
    const ids = this.projectIds();
    const mine = this.peek(s, ids);
    return {
      this_session: mine ? ids.get(mine) : null,
      ...(s.pinned ? { pinned_by_url: s.pinned } : {}),
      projects: this.windows.map((w) => ({
        project: ids.get(w),
        file: w.file,
        window: w.label,
        claude_sessions: this.sessionsOn(w, ids).length,
        ...(w === mine ? { yours: true } : {}),
      })),
    };
  }

  useProject(s: Session, query: string) {
    if (s.pinned) throw new Error(`Denne økta er låst til prosjektet «${s.pinned}» av adressen sin (.mcp.json) og kan ikke bytte.`);
    const ids = this.projectIds();
    const q = query.trim();
    const win =
      [...ids].find(([, id]) => id === q.toLowerCase())?.[0] ??
      this.windows.find((w) => w.label === q || (w.file && (samePath(w.file, q) || samePath(w.file.split(/[\\/]/).pop()!, q))));
    if (!win) throw new Error(`Fant ikke «${query}». Åpne prosjekter: ${this.describe(ids)}. Bruk open_project for å åpne en scenefil.`);
    s.window = win.label;
    hubLog(`${this.who(s)} bruker ${ids.get(win)}`);
    this.pushStatus();
    return { project: ids.get(win), file: win.file, window: win.label };
  }

  async openProject(s: Session, path?: string) {
    if (s.pinned) throw new Error(`Denne økta er låst til prosjektet «${s.pinned}» av adressen sin (.mcp.json) og kan ikke bytte.`);
    const existing = path ? this.windows.find((w) => w.file && samePath(w.file, path)) : undefined;
    if (existing) return { ...this.useProject(s, existing.label), already_open: true };
    const asker = this.peek(s) ?? this.windows[0];
    if (!asker) throw new Error(NOT_CONNECTED);
    const { window: label } = (await asker.call("open_window", { path: path ?? null }, 20000)) as { window: string };
    const deadline = Date.now() + OPEN_WINDOW_TIMEOUT_MS;
    while (!this.windows.some((w) => w.label === label)) {
      if (Date.now() > deadline) throw new Error(`Vinduet ${label} ble åpnet, men koblet ikke til huben.`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const result = this.useProject(s, label);
    if (path && !result.file) return { ...result, warning: "The window opened, but the file could not be loaded – the error is shown in the window." };
    return result;
  }

  // ---------- MCP over HTTP ----------

  private makeServer(): McpServer {
    const server = new McpServer({ name: "luna3d", version: VERSION }, { instructions: this.instructions });
    for (const t of this.tools) (server.registerTool as any)(t.name, t.config, this.wrap(t.name, t.handler));
    return server;
  }

  /** Kjører verktøyet med økta som kontekst (for `bridge`) og logger hvem som gjorde hva. */
  private wrap(name: string, handler: ToolHandler): ToolHandler {
    return (...args) => {
      const extra = args[args.length - 1] as { sessionId?: string } | undefined;
      const s = this.sessions.get(extra?.sessionId ?? "");
      if (!s) return { content: [{ type: "text", text: "Ukjent MCP-økt" }], isError: true };
      s.lastActivity = Date.now();
      const started = Date.now();
      return sessionScope.run(s, async () => {
        let status = "ok";
        try {
          const result = (await handler(...args)) as { isError?: boolean };
          if (result?.isError) status = "feil";
          return result;
        } catch (e) {
          status = "unntak";
          throw e;
        } finally {
          const win = this.peek(s);
          hubLog(`${this.who(s)} ${win ? this.projectIds().get(win) : "-"} ${name} ${status} ${Date.now() - started}ms`);
        }
      });
    };
  }

  private liveCount() {
    return [...this.sessions.values()].filter((s) => this.live(s)).length;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", HUB_URL);
    // Nettsider skal ikke kunne snakke med huben (proxyen og Claude Code sender ikke Origin).
    if (req.headers.origin) return void res.writeHead(403).end();

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      const ids = this.projectIds();
      return void res.end(
        JSON.stringify({
          app: "luna3d-hub",
          version: VERSION,
          stamp: this.stamp,
          pid: process.pid,
          live: this.liveCount(),
          sessions: this.sessions.size,
          projects: this.windows.map((w) => ids.get(w)),
        }),
      );
    }
    if (url.pathname === "/shutdown" && req.method === "POST") {
      if (this.liveCount() > 0) return void res.writeHead(409).end("busy");
      hubLog("avslutter (ny kode)");
      res.writeHead(200).end("ok", () => process.exit(0));
      return;
    }

    const route = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
    if (!route) return void res.writeHead(404).end();
    const body = req.method === "POST" ? await readJson(req) : undefined;
    const sid = req.headers["mcp-session-id"];

    if (typeof sid === "string") {
      const s = this.sessions.get(sid);
      if (!s) {
        res.writeHead(404, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
      }
      s.lastActivity = Date.now();
      if (req.method === "GET") {
        s.streams++;
        res.on("close", () => {
          s.streams--;
          s.lastActivity = Date.now();
        });
      }
      return s.transport.handleRequest(req, res, body);
    }

    if (req.method !== "POST" || !isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Missing session id" }, id: null }));
    }

    const port = url.port;
    const pinned = route[1] ? decodeURIComponent(route[1]).toLowerCase() : null;
    const session = { pinned, window: null, streams: 0, lastActivity: Date.now() } as unknown as Session;
    session.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
      onsessioninitialized: (id) => {
        session.id = id;
        this.sessions.set(id, session);
        hubLog(`${this.who(session)} ny økt${pinned ? ` låst til ${pinned}` : ""}`);
        this.pushStatus();
      },
    });
    session.transport.onclose = () => {
      if (!session.id || !this.sessions.delete(session.id)) return;
      hubLog(`${this.who(session)} økta ble avsluttet`);
      this.pushStatus();
    };
    session.server = this.makeServer();
    await session.server.connect(session.transport);
    await session.transport.handleRequest(req, res, body);
  }

  private housekeeping() {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (s.streams === 0 && now - s.lastActivity > STALE_MS) {
        hubLog(`${this.who(s)} rydder bort økt uten liv`);
        s.transport.close().catch(() => {});
        this.sessions.delete(s.id);
      }
    }
    if (this.liveCount() > 0) this.lastLive = now;
    else if (now - this.lastLive > IDLE_EXIT_MS) {
      hubLog("ingen økter på en stund – avslutter");
      process.exit(0);
    }
    this.pushStatus();
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
