#!/usr/bin/env node
/**
 * Luna 3D MCP-server.
 *
 * Claude Code starter denne over stdio. Serveren åpner en WebSocket på
 * 127.0.0.1 som Luna 3D-appen kobler seg til, og videresender verktøykall
 * fra Claude til appen. Kjøres direkte med Node (type stripping), uten byggesteg.
 *
 * NB: stdout tilhører MCP-protokollen – all logging går til stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { BRIDGE_PORT, type BridgeMethod, type BridgeResponse } from "../src/bridge/protocol.ts";

const PORT = Number(process.env.LUNA_BRIDGE_PORT ?? BRIDGE_PORT);
const log = (...args: unknown[]) => console.error("[luna3d-mcp]", ...args);

// Kun appen (dev-server eller bygget Tauri-app) får koble til – ikke tilfeldige nettsider.
const ALLOWED_ORIGINS = new Set(["http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class AppBridge {
  socket: WebSocket | null = null;
  listenError: string | null = null;
  pending = new Map<string, Pending>();
  seq = 0;

  constructor(port: number) {
    const wss = new WebSocketServer({
      host: "127.0.0.1",
      port,
      verifyClient: ({ origin }: { origin?: string }) => !origin || ALLOWED_ORIGINS.has(origin),
    });
    wss.on("listening", () => log(`venter på Luna 3D-appen på ws://127.0.0.1:${port}`));
    wss.on("error", (err: NodeJS.ErrnoException) => {
      this.listenError =
        err.code === "EADDRINUSE"
          ? `Port ${port} er opptatt – trolig kjører en annen Claude-økt med Luna 3D-broen allerede. Lukk den, eller sett LUNA_BRIDGE_PORT.`
          : `Kunne ikke starte broen: ${err.message}`;
      log(this.listenError);
    });
    wss.on("connection", (ws) => {
      log("appen koblet til");
      this.socket?.close();
      this.socket = ws;
      ws.on("message", (data) => this.onMessage(String(data)));
      ws.on("close", () => {
        if (this.socket !== ws) return;
        log("appen koblet fra");
        this.socket = null;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("Luna 3D-appen koblet fra før svaret kom"));
          this.pending.delete(id);
        }
      });
    });
  }

  onMessage(raw: string) {
    let msg: BridgeResponse | { type: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return log("ugyldig melding fra appen");
    }
    if ("type" in msg) return log("hei fra appen:", raw);
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  call(method: BridgeMethod, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<any> {
    if (this.listenError) return Promise.reject(new Error(this.listenError));
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("Luna 3D-appen er ikke tilkoblet. Be brukeren starte den (`npm run tauri dev` i prosjektmappa) og prøv igjen."),
      );
    }
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tidsavbrudd: appen svarte ikke på ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

const bridge = new AppBridge(PORT);

// ---------- Skjema ----------

const SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"] as const;
const VIEWS = ["current", "front", "back", "left", "right", "top", "iso"] as const;
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const objectProps = {
  name: z.string().optional().describe("Display name, e.g. 'Table leg 1'. Auto-generated if omitted."),
  position: vec3.optional().describe("Center of the object in meters [x, y, z]. Y is up; the ground is y = 0."),
  rotation: vec3.optional().describe("Euler rotation in DEGREES [x, y, z] (XYZ order)."),
  scale: vec3.optional().describe("Size in meters [x, y, z] (all primitives are unit-sized, so scale = dimensions)."),
  color: z.string().optional().describe("Hex color, e.g. '#ff8800'."),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional().describe("1 = solid, lower = transparent."),
  visible: z.boolean().optional(),
};

const INSTRUCTIONS = `Luna 3D is a simple 3D editor the user has open on their desktop. These tools edit its scene live.

Coordinate system: meters, Y is up, the ground plane is y = 0. Rotation is in degrees.
All primitives are unit-sized and centered on their origin, so 'scale' equals the object's size in meters:
- box: 1×1×1 cube
- sphere: diameter 1
- cylinder / cone: diameter 1, height 1 (along Y)
- torus: lies flat, outer diameter 1, tube thickness 0.3
- plane: flat 1×1 square in the XZ plane (zero thickness)
- capsule: 0.5 wide, 1 tall (along Y)
To rest an object on the ground, set position.y = scale.y / 2 (planes: y = 0).

Workflow tips: call get_scene first to see existing objects and their ids. Build composite things from several primitives
with one add_objects call. Use screenshot to check your work visually — try different views. Every change is undoable by the user.`;

const server = new McpServer({ name: "luna3d", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

async function run(method: BridgeMethod, params: Record<string, unknown> = {}) {
  try {
    return json(await bridge.call(method, params));
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
}

// ---------- Verktøy ----------

server.registerTool(
  "get_scene",
  {
    title: "Get scene",
    description: "List every object in the Luna 3D scene with id, type, transform and material, plus the selected id.",
    inputSchema: {},
  },
  () => run("get_scene"),
);

server.registerTool(
  "add_objects",
  {
    title: "Add objects",
    description: "Add one or more primitive objects to the scene. Returns their new ids. Prefer adding all parts of a model in one call.",
    inputSchema: {
      objects: z.array(z.object({ type: z.enum(SHAPES), ...objectProps })).min(1),
    },
  },
  ({ objects }) => run("add_objects", { objects }),
);

server.registerTool(
  "update_objects",
  {
    title: "Update objects",
    description: "Change properties of existing objects by id. Only the given fields change. Several objects can be updated at once.",
    inputSchema: {
      updates: z.array(z.object({ id: z.string(), ...objectProps })).min(1),
    },
  },
  ({ updates }) => run("update_objects", { updates }),
);

server.registerTool(
  "delete_objects",
  {
    title: "Delete objects",
    description: "Delete objects by id.",
    inputSchema: { ids: z.array(z.string()).min(1) },
  },
  ({ ids }) => run("delete_objects", { ids }),
);

server.registerTool(
  "select_object",
  {
    title: "Select object",
    description: "Select an object in the editor (shows its properties and move gizmo to the user). Pass null to deselect.",
    inputSchema: { id: z.string().nullable() },
  },
  ({ id }) => run("select", { id }),
);

server.registerTool(
  "clear_scene",
  {
    title: "Clear scene",
    description: "Remove ALL objects from the scene (undoable). Only do this when the user wants a fresh start.",
    inputSchema: {},
  },
  () => run("clear_scene"),
);

server.registerTool(
  "undo",
  { title: "Undo", description: "Undo the last change in the editor.", inputSchema: {} },
  () => run("undo"),
);

server.registerTool(
  "redo",
  { title: "Redo", description: "Redo the last undone change.", inputSchema: {} },
  () => run("redo"),
);

server.registerTool(
  "set_view",
  {
    title: "Set camera view",
    description: "Move the user's camera so the whole scene is framed from the given direction.",
    inputSchema: { view: z.enum(VIEWS).describe("'current' keeps the direction but re-frames the scene.") },
  },
  ({ view }) => run("set_view", { view }),
);

server.registerTool(
  "screenshot",
  {
    title: "Screenshot viewport",
    description:
      "Capture an image of the 3D viewport so you can see the scene. Optionally reframe the camera first (this also moves the user's view).",
    inputSchema: {
      view: z.enum(VIEWS).optional().describe("Reframe from this direction first. Omit to capture exactly what the user sees."),
      width: z.number().int().min(256).max(1920).optional().describe("Max image width in pixels (default 1024)."),
    },
  },
  async ({ view, width }) => {
    try {
      const shot = await bridge.call("screenshot", { view, width });
      return {
        content: [
          { type: "image" as const, data: shot.base64 as string, mimeType: "image/png" },
          { type: "text" as const, text: `${shot.width}×${shot.height}px${view ? `, view: ${view}` : ""}` },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }
  },
);

server.registerTool(
  "save_scene",
  {
    title: "Save scene",
    description: "Save the scene as a Luna 3D JSON file (.luna.json) at an absolute path.",
    inputSchema: { path: z.string().describe("Absolute file path, e.g. C:\\Users\\me\\Documents\\house.luna.json") },
  },
  ({ path }) => run("save_scene", { path }),
);

server.registerTool(
  "load_scene",
  {
    title: "Load scene",
    description: "Open a Luna 3D scene file (.luna.json), replacing the current scene (undoable).",
    inputSchema: { path: z.string().describe("Absolute file path") },
  },
  ({ path }) => run("load_scene", { path }),
);

server.registerTool(
  "export_glb",
  {
    title: "Export GLB",
    description: "Export visible objects as a binary glTF (.glb) file that Blender, Roblox Studio, Unity, Godot etc. can import.",
    inputSchema: { path: z.string().describe("Absolute file path ending in .glb") },
  },
  ({ path }) => run("export_glb", { path }),
);

await server.connect(new StdioServerTransport());
log("MCP-server klar");

// Avslutt når Claude Code lukker forbindelsen, så porten ikke blir hengende opptatt.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
