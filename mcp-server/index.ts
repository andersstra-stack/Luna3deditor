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
import { readFileSync } from "node:fs";
import { BRIDGE_BUSY_CODE, BRIDGE_PORT, type BridgeMethod, type BridgeResponse } from "../src/bridge/protocol.ts";
import { ADDABLE_SHAPES } from "../src/types.ts";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
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
      // Første vindu beholder koblingen; ellers ville to vinduer sparket hverandre ut i en løkke.
      if (this.socket?.readyState === WebSocket.OPEN) {
        log("avviser ekstra app-vindu (et annet er allerede tilkoblet)");
        ws.close(BRIDGE_BUSY_CODE, "busy");
        return;
      }
      log("appen koblet til");
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
  hole: z
    .boolean()
    .optional()
    .describe("true = this object is a HOLE: it is shown as a ghost and cut away (CSG) from the other objects in the SAME folder."),
  intensity: z.number().min(0).optional().describe("Lights only: brightness in candela (pointLight ~20, spotLight ~60)."),
  folderId: z
    .string()
    .nullable()
    .optional()
    .describe("Folder to place the object in (id from create_folders / get_scene). null = scene root."),
};

const INSTRUCTIONS = `Luna 3D is a simple 3D editor the user has open on their desktop. These tools edit its scene live.

Coordinate system: meters, Y is up, the ground plane is y = 0. Rotation is in degrees (Euler XYZ).
All shapes are unit-sized and centered on their origin, so 'scale' equals the object's size in meters:
- box: 1×1×1 cube; roundedBox: same with rounded edges
- sphere: diameter 1; hemisphere: dome, flat side down (default scale [1, 0.5, 1])
- cylinder / cone: diameter 1, height 1 (along Y); tube: hollow cylinder (wall = 15% of the diameter)
- pyramid: square 1×1 base, apex up
- prism: triangular "gable roof" — ridge runs along Z, slopes face ±X
- wedge: ramp — tall side at -X, low edge at +X (extruded along Z)
- stairs: 4 steps rising toward +X (extruded along Z)
- torus: lies flat, outer diameter 1, tube thickness 0.3
- plane: flat 1×1 square in the XZ plane (zero thickness)
- capsule: 0.5 wide, 1 tall (along Y)
- pointLight / spotLight: light sources (spotLight shines along its local -Y; rotate it to aim). Use 'intensity' and 'color'.
To rest an object on the ground, set position.y = scale.y / 2 (planes: y = 0) — or call drop_to_ground.

get_scene returns each object's exact world-space bounding box ('bounds' min/max), which makes it easy to place
things flush against each other (e.g. new.position.x = other.bounds.max.x + new.scale.x / 2).

Holes (CSG): set hole: true on an object to cut it out of every other (non-hole) object in the SAME folder it overlaps —
e.g. windows and doors in a wall: put the wall and box-shaped holes in one folder. Holes are live and stay editable.

Imported models: import_model loads an FBX, GLB/glTF, OBJ or STL file from disk. Each mesh in the file becomes an object of
type "mesh" (several parts are put in their own folder). Like every other shape they are normalized to a unit box, so 'scale'
is their size in meters; centimeter/millimeter files are scaled to meters automatically. Meshes can be moved, scaled, recolored,
mirrored, duplicated and cut with holes, but their geometry can't be edited.

Folders: purely organizational (like a file tree) — they have no transform of their own and can be nested.
For anything with more than a handful of parts, put parts in descriptive folders (e.g. "House" > "Roof", "Walls").
Create folders first with create_folders, then pass folderId in add_objects. Hidden folders hide everything inside them.

Helpers: duplicate_objects (repeat parts with an offset), mirror_objects (symmetric models: build one side, mirror-copy
across x = 0), align_objects, drop_to_ground.

Workflow tips: call get_scene first to see existing objects and their ids. Build composite things from several shapes
with one add_objects call. Use screenshot to check your work visually — try different views. Every change is undoable by the user.`;

const server = new McpServer({ name: "luna3d", version: VERSION }, { instructions: INSTRUCTIONS });

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
    description:
      "List every folder and object in the Luna 3D scene (ids, folder tree, transforms, materials, world-space bounds) plus the selected ids.",
    inputSchema: {},
  },
  () => run("get_scene"),
);

server.registerTool(
  "add_objects",
  {
    title: "Add objects",
    description: "Add one or more shapes or lights to the scene. Returns their new ids. Prefer adding all parts of a model in one call.",
    inputSchema: {
      objects: z.array(z.object({ type: z.enum(ADDABLE_SHAPES), ...objectProps })).min(1),
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
  "create_folders",
  {
    title: "Create folders",
    description:
      "Create one or more folders for organizing objects. Returns their ids. To nest, create the parent first and pass its id as parentId.",
    inputSchema: {
      folders: z
        .array(
          z.object({
            name: z.string().describe("Folder name, e.g. 'Roof'"),
            parentId: z.string().nullable().optional().describe("Parent folder id; omit or null for the scene root."),
          }),
        )
        .min(1),
    },
  },
  ({ folders }) => run("create_folders", { folders }),
);

server.registerTool(
  "update_folders",
  {
    title: "Update folders",
    description: "Rename, show/hide or move (re-parent) folders. To move objects between folders use update_objects with folderId.",
    inputSchema: {
      updates: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            visible: z.boolean().optional().describe("false hides the folder and everything inside it"),
            parentId: z.string().nullable().optional().describe("New parent folder id; null = scene root."),
          }),
        )
        .min(1),
    },
  },
  ({ updates }) => run("update_folders", { updates }),
);

server.registerTool(
  "delete_folders",
  {
    title: "Delete folders",
    description:
      "Delete folders. By default their contents (objects and subfolders) are moved up to the parent folder. Set deleteContents to also delete everything inside.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
      deleteContents: z.boolean().optional(),
    },
  },
  ({ ids, deleteContents }) => run("delete_folders", { ids, deleteContents }),
);

server.registerTool(
  "select_objects",
  {
    title: "Select objects",
    description:
      "Select objects in the editor (outlines them and shows the move gizmo to the user). Pass an empty list to deselect.",
    inputSchema: { ids: z.array(z.string()) },
  },
  ({ ids }) => run("select", { ids }),
);

server.registerTool(
  "duplicate_objects",
  {
    title: "Duplicate objects",
    description: "Copy objects (same folder and properties), moved by an offset. Returns the new ids in the same order.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
      offset: vec3.optional().describe("Offset in meters for the copies (default [1, 0, 0])."),
    },
  },
  ({ ids, offset }) => run("duplicate_objects", { ids, offset }),
);

server.registerTool(
  "drop_to_ground",
  {
    title: "Drop to ground",
    description:
      "Move the objects (as one group) straight down/up so they rest on the highest object beneath them, or on the ground (y = 0).",
    inputSchema: { ids: z.array(z.string()).min(1) },
  },
  ({ ids }) => run("drop_to_ground", { ids }),
);

server.registerTool(
  "align_objects",
  {
    title: "Align objects",
    description:
      "Align objects' bounding boxes on one axis to a target object (default: the last id in the list). Each object moves individually.",
    inputSchema: {
      ids: z.array(z.string()).min(2),
      axis: z.enum(["x", "y", "z"]),
      mode: z.enum(["min", "center", "max"]),
      targetId: z.string().optional().describe("Object to align to; defaults to the last id in ids."),
    },
  },
  ({ ids, axis, mode, targetId }) => run("align_objects", { ids, axis, mode, targetId }),
);

server.registerTool(
  "mirror_objects",
  {
    title: "Mirror objects",
    description:
      "Mirror objects across a plane perpendicular to an axis. copy: true makes mirrored copies (default plane: axis = 0, ideal for symmetric models); otherwise the objects are flipped in place (default plane: the selection's center). Returns the resulting ids.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
      axis: z.enum(["x", "y", "z"]),
      copy: z.boolean().optional(),
      plane: z.number().optional().describe("Coordinate of the mirror plane on the axis."),
    },
  },
  ({ ids, axis, copy, plane }) => run("mirror_objects", { ids, axis, copy, plane }),
);

server.registerTool(
  "clear_scene",
  {
    title: "Clear scene",
    description: "Remove ALL objects and folders from the scene (undoable). Only do this when the user wants a fresh start.",
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
  "import_model",
  {
    title: "Import 3D model",
    description:
      "Import an FBX, GLB/glTF (embedded only), OBJ or STL file from disk into the scene. Returns the new object ids, the folder created for multi-part models, the applied unit scale and the overall size in meters. By default it is placed on the ground where the user's camera looks.",
    inputSchema: {
      path: z.string().describe("Absolute path to the model file"),
      folderId: z.string().nullable().optional().describe("Folder to import into (default: scene root)."),
      position: vec3.optional().describe("Where to put the model: [x, y, z] = center of its footprint at height y (default: on the ground where the camera looks)."),
    },
  },
  ({ path, folderId, position }) => run("import_model", { path, folderId, position }),
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
