// Tester huben med to falske appvinduer og to MCP-klienter (som to Claude-økter) på egne testporter.
// Trenger ikke appen. Bruk (fra repoet): node mcp-server/hub-test.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, LUNA_BRIDGE_PORT: "47417", LUNA_HUB_PORT: "47418" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` – ${detail}` : ""}`);
};

// Falskt vindu: svarer på get_scene med sin egen fil, og logger hvilke kall det fikk (med overlapp-sjekk).
function fakeWindow(label, file, delayMs = 0) {
  const w = { label, file, calls: [], busy: 0, maxBusy: 0, status: null, statuses: [] };
  const connect = () => {
    const ws = new WebSocket("ws://127.0.0.1:47417");
    w.ws = ws;
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", app: "luna3d", version: "test", window: label, file })));
    ws.on("message", async (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === "status") {
        w.status = msg;
        w.statuses.push(msg);
        return;
      }
      w.busy++;
      w.maxBusy = Math.max(w.maxBusy, w.busy);
      w.calls.push(msg.method);
      await sleep(delayMs);
      w.busy--;
      const result = msg.method === "get_scene" ? { window: label, file: w.file, objects: [] } : { ok: true, window: label };
      ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
    });
    ws.on("close", () => !w.closed && setTimeout(connect, 300));
    ws.on("error", () => {});
  };
  connect();
  w.close = () => {
    w.closed = true;
    w.ws.close();
  };
  return w;
}

async function session(name, extraEnv = {}) {
  const transport = new StdioClientTransport({ command: "node", args: ["mcp-server/index.ts"], cwd: repo, env: { ...env, ...extraEnv }, stderr: "inherit" });
  const client = new Client({ name, version: "0" });
  await client.connect(transport);
  const call = async (tool, args = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { error: r.isError ? text : null, data };
  };
  return { client, call, transport };
}

const a = await session("økt-A");
const tools = (await a.client.listTools()).tools.map((t) => t.name);
check("verktøyene finnes", ["list_projects", "use_project", "open_project", "get_scene"].every((t) => tools.includes(t)), `${tools.length} verktøy`);

const health = await (await fetch("http://127.0.0.1:47418/health")).json();
check("huben svarer på /health", health.app === "luna3d-hub", `pid ${health.pid}`);

// Uten vindu
const none = await a.call("get_scene");
check("uten vindu: feilmelding", none.error?.includes("ikke tilkoblet"), none.error ?? "");

// Ett vindu: velges automatisk
const romskip = fakeWindow("main", "C:\\scener\\Romskip Mk2.luna.json", 300);
await sleep(600);
const one = await a.call("get_scene");
check("ett vindu velges automatisk", one.data?.window === "main", JSON.stringify(one.data));

// To vinduer: ny økt må velge
const stasjon = fakeWindow("luna-2", "C:\\scener\\Stasjon.luna.json", 300);
await sleep(600);
const b = await session("økt-B");
const amb = await b.call("get_scene");
check("to vinduer: økt B må velge", amb.error?.includes("use_project"), amb.error ?? "");
const list = await b.call("list_projects");
check("list_projects viser begge", list.data?.projects?.length === 2, JSON.stringify(list.data?.projects?.map((p) => p.project)));
const used = await b.call("use_project", { project: "stasjon" });
check("use_project stasjon", used.data?.window === "luna-2", JSON.stringify(used.data));
check("økt A er fortsatt på romskip", (await a.call("get_scene")).data?.window === "main");

// Samtidighet: ulike vinduer parallelt, samme vindu i kø
let t0 = Date.now();
await Promise.all([a.call("get_scene"), b.call("get_scene")]);
const parallel = Date.now() - t0;
check("ulike vinduer kjører samtidig", parallel < 550, `${parallel} ms for 2×300 ms`);
t0 = Date.now();
romskip.maxBusy = 0;
await b.call("use_project", { project: "romskip-mk2" });
await Promise.all([a.call("get_scene"), b.call("get_scene"), a.call("get_scene")]);
const queued = Date.now() - t0;
check("samme vindu: ett kall om gangen", romskip.maxBusy === 1 && queued >= 850, `maks ${romskip.maxBusy} samtidig, ${queued} ms`);
await b.call("use_project", { project: "stasjon" });
await sleep(300);
check("vinduet får status med antall økter", romskip.status?.sessions === 1 && stasjon.status?.sessions === 1, JSON.stringify([romskip.status, stasjon.status]));

// Låst via adresse
const c = await session("økt-C", { LUNA3D_PROJECT: "stasjon" });
check("låst økt går til stasjon", (await c.call("get_scene")).data?.window === "luna-2");
check("låst økt kan ikke bytte", !!(await c.call("use_project", { project: "romskip-mk2" })).error);

// open_project: fila er allerede åpen → velges
const already = await b.call("open_project", { path: "c:/scener/romskip mk2.luna.json" });
check("open_project på åpen fil velger den", already.data?.already_open && already.data?.window === "main", JSON.stringify(already.data));

// Vinduet lukkes
stasjon.close();
await sleep(300);
const gone = await c.call("get_scene");
check("låst økt: prosjektet er lukket", gone.error?.includes("ikke åpent"), gone.error ?? "");

// Fil byttes (lagre som) → prosjekt-id følger
romskip.file = "C:\\scener\\Ny.luna.json";
romskip.ws.send(JSON.stringify({ type: "project", file: romskip.file }));
await sleep(200);
const after = await a.call("list_projects");
check("prosjekt-id følger filnavnet", after.data?.projects?.[0]?.project === "ny", JSON.stringify(after.data));

// Huben dør: proxyen starter en ny og fortsetter
const pid = (await (await fetch("http://127.0.0.1:47418/health")).json()).pid;
process.kill(pid);
await sleep(500);
const revived = await a.call("get_scene");
const pid2 = (await (await fetch("http://127.0.0.1:47418/health")).json()).pid;
await sleep(1000);
const revived2 = await a.call("get_scene");
check("proxyen gjenoppretter økta etter at huben døde", pid2 !== pid && (revived.data?.window === "main" || revived2.data?.window === "main"), `${revived.error ?? "ok"} / ${revived2.error ?? "ok"}`);

for (const s of [a, b, c]) await s.client.close();
romskip.close();
await sleep(500);
const end = await (await fetch("http://127.0.0.1:47418/health")).json();
check("øktene avsluttes når klientene lukker", end.sessions === 0, JSON.stringify(end));
await fetch("http://127.0.0.1:47418/shutdown", { method: "POST" });
console.log(failures ? `${failures} feil` : "alt ok");
process.exit(failures ? 1 : 0);
