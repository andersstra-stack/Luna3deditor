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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPythonScript } from "./python.ts";
import { BRIDGE_BUSY_CODE, BRIDGE_PORT, type BridgeMethod, type BridgeResponse } from "../src/bridge/protocol.ts";
import { ADDABLE_SHAPES } from "../src/types.ts";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const PORT = Number(process.env.LUNA_BRIDGE_PORT ?? BRIDGE_PORT);
const log = (...args: unknown[]) => console.error("[luna3d-mcp]", ...args);
const LISTEN_RETRY_MS = 3000;

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
    this.listen(port);
  }

  listen(port: number) {
    const wss = new WebSocketServer({
      host: "127.0.0.1",
      port,
      verifyClient: ({ origin }: { origin?: string }) => !origin || ALLOWED_ORIGINS.has(origin),
    });
    wss.on("listening", () => {
      this.listenError = null;
      log(`venter på Luna 3D-appen på ws://127.0.0.1:${port}`);
    });
    wss.on("error", (err: NodeJS.ErrnoException) => {
      const busy = err.code === "EADDRINUSE";
      const error = busy
        ? `Port ${port} er opptatt – trolig kjører en annen Claude-økt med Luna 3D-broen allerede. Lukk den, eller sett LUNA_BRIDGE_PORT. Prøver igjen av seg selv.`
        : `Kunne ikke starte broen: ${err.message}`;
      if (error !== this.listenError) log(error);
      this.listenError = error;
      // Porten blir ledig når den andre økten avslutter – prøv igjen, så broen kommer seg uten omstart.
      if (busy) {
        wss.close();
        setTimeout(() => this.listen(port), LISTEN_RETRY_MS).unref();
      }
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
  emissive: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Glow 0–1 in the object's own color (windows, lamps, screens, engine nozzles). Exported as the palette's _emission map."),
  material: z
    .string()
    .optional()
    .describe("Material name in the exported GLB, e.g. 'nova_glass' (Unity swaps it for its glass). Omit / empty for the shared palette material."),
  props: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe(
      "Nodes only: custom properties, exported as glTF extras (like Blender Custom Properties). Flat key/value pairs, numbers or text only (use 1/0 for flags), e.g. { type: 'pirate_grunt' } or { yaw_min: -150, yaw_max: 150 }. Replaces the whole set.",
    ),
  folderId: z
    .string()
    .nullable()
    .optional()
    .describe("Folder to place the object in (id from create_folders / get_scene). null = scene root."),
  taper: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Cylinder only: top diameter relative to the bottom (1 = straight, 0.6 = trunk-like, 0 = pointed). Flip it 180° to be wider at the top."),
  points: z
    .array(vec3)
    .min(2)
    .optional()
    .describe(
      "Curve only: WORLD-space points [x, y, z] the tube passes through (smooth curve). position/rotation/scale are then derived from them – omit those.",
    ),
  radius: z
    .union([z.number().min(0), z.array(z.number().min(0))])
    .optional()
    .describe("Curve only: tube radius in meters – one number, or one per point for a tapering tube (e.g. [0.12, 0.07, 0.02]). Default 0.1."),
};

/** Kun add_objects: egne former fra hjørner og trekanter (type "mesh"). */
const meshProps = {
  vertices: z
    .array(vec3)
    .min(3)
    .optional()
    .describe("type 'mesh' only: corner points [x, y, z] in the shape's OWN coordinates (meters). 'position' is where its origin goes, 'rotation' turns it around that origin."),
  triangles: z
    .array(z.tuple([z.number().int(), z.number().int(), z.number().int()]))
    .optional()
    .describe("type 'mesh' only: triangles as vertex indices [a, b, c], counter-clockwise seen from outside."),
  vertex_colors: z.array(z.string()).optional().describe("type 'mesh' only: one hex color per vertex (optional)."),
  smooth: z.boolean().optional().describe("type 'mesh' only: true = smooth shading across shared vertices; default flat facets."),
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
- cylinder with 'taper' (0–1): top diameter relative to the bottom – tree trunks, table legs, vases, horns
- mesh (custom shape): give 'vertices' (in the shape's own coordinates, meters) and 'triangles' (index triples,
  counter-clockwise seen from outside) – leaves, rocks, capes, blades, anything that is not a primitive. 'position' is
  where the vertices' origin goes and 'rotation' turns it around that origin; 'scale' is then the shape's size like
  everything else. Identical shapes are stored once, so reuse one leaf for hundreds of copies. Optional
  'vertex_colors' (one hex per vertex) and 'smooth'. A thin shape seen from both sides needs both faces (top and a
  reversed bottom). Its geometry can't be edited afterwards – make a new object.
- curve: a round tube along a smooth curve through 'points' (WORLD coordinates) with 'radius' (one number, or one per
  point to taper it) – branches, roots, cables, handles, tentacles, horns. Give points + radius instead of
  position/scale; get_scene returns its current world 'points' and 'radius'. Sending new points to update_objects
  reshapes it; sending only radius keeps it in place. Start a branch slightly INSIDE its parent (e.g. inside the trunk)
  so the joint looks grown, not glued on.
- pointLight / spotLight: light sources (spotLight shines along its local -Y; rotate it to aim). Use 'intensity' and 'color'.
- node: an invisible marker point for game engines (see "Marker nodes" below). 'scale' is only its size in the editor.
To rest an object on the ground, set position.y = scale.y / 2 (planes: y = 0) — or call drop_to_ground.

get_scene returns each object's exact world-space bounding box ('bounds' min/max), which makes it easy to place
things flush against each other (e.g. new.position.x = other.bounds.max.x + new.scale.x / 2).

Export & materials (like the Nova library): export_glb writes ONE shared palette material per look – every color is a
pixel in <name>_palette.png (also embedded in the GLB) and each part's UVs point at its pixel. 'emissive' (0–1) makes a
part glow and goes into <name>_emission.png. Set material: 'nova_glass' on glass so Unity swaps in its glass shader;
imported models keep their material names from the file.

Holes (CSG): set hole: true on an object to cut it out of every other (non-hole) object in the SAME folder it overlaps —
e.g. windows and doors in a wall: put the wall and box-shaped holes in one folder. Holes are live and stay editable.

Imported models: import_model loads an FBX, GLB/glTF, OBJ or STL file from disk. Each mesh in the file becomes an object of
type "mesh" (several parts are put in their own folder). Like every other shape they are normalized to a unit box, so 'scale'
is their size in meters; centimeter/millimeter files are scaled to meters automatically. Meshes can be moved, scaled, recolored,
mirrored, duplicated and cut with holes, but their geometry can't be edited. Empty nodes in FBX/GLB files (Blender
Empties) become marker nodes with their Custom Properties / extras as props. FBX is turned 180° about Y on import so a
GLB exported from Luna lands where the FBX does in Unity (Luna x = −Blender x, Luna z = Blender y).

Marker nodes: type "node" is a named, invisible point with a direction – dock points, weapon hardpoints, engines,
spawn points, doors, loot spots – that the game (SpaceRUS, Unity) finds by NAME. Local +Z is "forward" and local +Y is
"up" (the same axes in Unity after import); get_scene gives each node its world 'forward' and 'up'. Put custom
properties in 'props'. Names must be exact and unique, no spaces or .001 – follow the game's conventions, e.g.
hp_turret_S_01 (up = out of the hull, forward = rest direction; props yaw_min/yaw_max/pitch_min/pitch_max),
engine_01 (forward points backwards out of the nozzle), nav_light_L/R, dock_clamp, land_point, cockpit,
boarding_door, dock_entry/dock_inside/undock (forward = nose direction), spawn_<room>_<nr> with props.type.
Props are flat numbers or text (no booleans – use 1/0). Duplicating a node numbers the copy (hp_01 → hp_02).
export_glb writes nodes as empty glTF nodes with props as extras; Unity (glTFast) reads them from there.

Python scripts: run_python runs Python code (or a .py file) that builds or edits the scene through the luna3d
module – best for anything repetitive or mathematical (fences, stairs, grids, rings, terrain, arrays of parts),
where one loop replaces hundreds of add_objects entries. The whole run is ONE undo step. API (import luna3d as luna):
- luna.box/sphere/cylinder/cone/torus/plane/capsule/wedge/prism/pyramid/stairs/hemisphere/tube/rounded_box/curve/
  point_light/spot_light/node(name=, position=(x,y,z), rotation=(deg,deg,deg), scale=(x,y,z), color="#rrggbb",
  metalness=, roughness=, opacity=, hole=, intensity=, emissive=, material=, props={...}, folder=) -> key; or luna.add("box", ...)
- luna.cylinder(taper=0.6, ...); luna.curve(points=[(x,y,z), ...], radius=0.1 or [r per point], color=..., folder=...)
- luna.mesh(vertices=[...], triangles=[...], position=, rotation=, color=, vertex_colors=, smooth=) – custom shapes;
  luna.orient(forward, up) -> rotation that points the shape's +Z along forward and +Y toward up (like nodes)
Large runs return only counts (not every id); use luna.objects(...) / get_scene to find objects afterwards.
- luna.folder(name, parent=None) -> key (use as folder=/parent=)
- luna.update(id_or_key, **props), luna.delete(*ids)
- luna.scene / luna.objects(name=, type=, folder=) / luna.folders(name=) / luna.get(id): the scene at start,
  objects include "bounds" {min, max}
print() output is returned to you; exceptions return the traceback and change nothing. Save reusable scripts with
save_to (e.g. a "skript" folder next to the user's scene). Objects made from a script FILE (path or save_to) remember it:
running the same file again REPLACES what it made last time (folders with the same name are reused), so iterate by
re-running the same save_to path. Inline code without save_to only adds. Examples: scripting/eksempler in the Luna 3D repo.

Comment pins (notes): the user can drop numbered pins with comments on objects or the ground ("this must change",
"move the door here"). When the user mentions pins, comments or "nålene"/"kommentarene", call get_notes – each note has
its text, the object it's on and a world position. Do the work, then reply_to_note with what you did and status "done".
Pins also appear (numbered) in screenshots. You may add_note yourself to point at problems or give constructive feedback
in place (e.g. a gap between walls) – keep it short and actionable.

Export as one model (for Unity/Unreal): set model: true on a folder (create_folders/update_folders, Python
luna.folder(name, model=True), or the package button in the scene list). export_glb then bakes everything in it –
including subfolders that are not models themselves – into ONE mesh with one palette material per look (submeshes when
metalness/roughness differ); colors stay as palette UVs. Marker nodes in it become children of the model. The model's
origin is a marker node named "pivot" in the folder (its position and rotation; the pivot itself is not exported), or
else the bottom center of its parts. For ANIMATION keep moving parts separate: a door, wheel, turret or lid gets its
own subfolder with model: true and a "pivot" node on its hinge/axle – it becomes a child mesh of the outer model that the
game can rotate. Skeletal rigs (characters) are done in Blender/Mixamo on the exported mesh. Keep parts as separate
shapes in Luna while working (easy to edit) – merging happens at export.

Folders: purely organizational (like a file tree) — they have no transform of their own and can be nested.
For anything with more than a handful of parts, put parts in descriptive folders (e.g. "House" > "Roof", "Walls").
Create folders first with create_folders, then pass folderId in add_objects. Hidden folders hide everything inside them.

Helpers: duplicate_objects (repeat parts with an offset), mirror_objects (symmetric models: build one side, mirror-copy
across x = 0), align_objects, drop_to_ground. split_loose_parts splits imported meshes into their unconnected pieces
(like Blender's "Separate by Loose Parts") so single pieces can be moved, recolored or deleted; merge_objects joins
several shapes/meshes into one mesh inside Luna (like Ctrl+J; every part keeps its color, the rest of the look comes from
the primary). Prefer model folders for export – merged meshes can't be edited part by part.

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
    description: "Add one or more shapes, lights or marker nodes to the scene. Returns their new ids. Prefer adding all parts of a model in one call.",
    inputSchema: {
      objects: z.array(z.object({ type: z.enum([...ADDABLE_SHAPES, "mesh"]), ...objectProps, ...meshProps })).min(1),
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
            model: z.boolean().optional().describe("true = export this folder as ONE model (one mesh, one palette material per look); see 'Export as one model' in the instructions."),
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
            model: z.boolean().optional().describe("true = export this folder as ONE model (one mesh, one palette material per look); see 'Export as one model' in the instructions."),
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
      "Import an FBX, GLB/glTF (embedded only), OBJ or STL file from disk into the scene. Returns the new object ids, the folder created for multi-part models, the applied unit scale and the overall size in meters. By default it is placed on the ground where the user's camera looks. Use keep_origin: true for parts that share an origin in the source file (e.g. a Blender interior and exterior) so they line up.",
    inputSchema: {
      path: z.string().describe("Absolute path to the model file"),
      folderId: z.string().nullable().optional().describe("Folder to import into (default: scene root)."),
      position: vec3
        .optional()
        .describe(
          "Where to put the model: [x, y, z] = center of its footprint at height y (default: on the ground where the camera looks). With keep_origin: where the file's origin goes (default [0, 0, 0]).",
        ),
      keep_origin: z
        .boolean()
        .optional()
        .describe(
          "true = keep the file's own origin (it goes to the scene origin, or to 'position') instead of centering the model. Omit to use the user's setting.",
        ),
    },
  },
  ({ path, folderId, position, keep_origin }) => run("import_model", { path, folderId, position, keep_origin }),
);

server.registerTool(
  "run_python",
  {
    title: "Run Python script",
    description:
      "Run a Python script that builds or edits the scene with the luna3d module (see the server instructions for the API). Give either 'code' or 'path' to an existing .py file. All changes are applied as one undo step; print() output and errors are returned.",
    inputSchema: {
      code: z.string().optional().describe("Python source, e.g. 'import luna3d as luna\nfor i in range(10): luna.box(position=(i, 0.5, 0))'"),
      path: z.string().optional().describe("Absolute path to an existing .py file to run instead of code."),
      save_to: z
        .string()
        .optional()
        .describe("Also save 'code' as a .py file at this absolute path. Re-running the same file replaces its previous result."),
    },
  },
  async ({ code, path, save_to }) => {
    const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
    if (!code === !path) return fail("Give exactly one of 'code' or 'path'.");
    const tmp = mkdtempSync(join(tmpdir(), "luna3d-script-"));
    try {
      let script = path!;
      if (code) {
        script = save_to ?? join(tmp, "script.py");
        writeFileSync(script, code, "utf8");
      }
      const scene = await bridge.call("get_scene");
      const run = await runPythonScript(script, scene);
      const output = [run.printed && `Script output:\n${run.printed}`, run.stderr && `stderr:\n${run.stderr}`].filter(Boolean).join("\n\n");
      if (!run.ops) return fail(`The script failed (exit code ${run.code}) – nothing was changed.\n\n${output}`);
      const name = (save_to ?? path ?? "Claude-skript").split(/[\\/]/).pop();
      // Kjent fil (path/save_to): forrige resultat fra samme skript erstattes. Inline-kode legger bare til.
      const scriptFile = path ?? save_to;
      const result = run.ops.length
        ? await bridge.call("apply_script", { ops: run.ops, name, script: scriptFile })
        : { note: "The script made no changes." };
      const saved = code && save_to ? `Saved to ${save_to}\n\n` : "";
      return json({ ...result, ...(output ? { output } : {}), ...(saved ? { saved: save_to } : {}) });
    } catch (e) {
      return fail((e as Error).message);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);

server.registerTool(
  "get_notes",
  {
    title: "Get comment pins",
    description:
      "List the comment pins in the scene (open ones by default): number, text, author (user/claude), the object it's pinned to, world position and replies.",
    inputSchema: { include_resolved: z.boolean().optional().describe("Also include pins marked as done.") },
  },
  ({ include_resolved }) => run("get_notes", { include_resolved }),
);

server.registerTool(
  "add_note",
  {
    title: "Add comment pin",
    description:
      "Pin a comment to an object (default: top center of it) or to a world position, e.g. to point out a problem or ask the user something about a specific spot.",
    inputSchema: {
      text: z.string().describe("The comment (Norwegian, short and actionable)."),
      objectId: z.string().optional().describe("Object to pin to – the pin follows it when it moves."),
      position: vec3.optional().describe("Exact world point for the pin (on the object's surface if objectId is given)."),
    },
  },
  ({ text, objectId, position }) => run("add_note", { text, objectId, position }),
);

server.registerTool(
  "reply_to_note",
  {
    title: "Reply to comment pin",
    description: "Reply to a pin (by id or number) and/or mark it done or open again. Use status 'done' when you have handled it.",
    inputSchema: {
      note: z.union([z.string(), z.number()]).describe("Pin id or its number"),
      text: z.string().optional().describe("Reply text, e.g. what you changed."),
      status: z.enum(["open", "done"]).optional(),
    },
  },
  ({ note, text, status }) => run("reply_to_note", { note, text, status }),
);

server.registerTool(
  "delete_notes",
  {
    title: "Delete comment pins",
    description: "Delete pins by id or number. Prefer reply_to_note with status 'done' so the user keeps the history.",
    inputSchema: { notes: z.array(z.union([z.string(), z.number()])).min(1) },
  },
  ({ notes }) => run("delete_notes", { notes }),
);

server.registerTool(
  "split_loose_parts",
  {
    title: "Split into loose parts",
    description:
      "Split imported models (type 'mesh') into their unconnected pieces, like Blender's 'Separate by Loose Parts'. Each piece becomes its own object named '<name>.1', '<name>.2' … (largest first) in the same folder, with the same look. One undo step. Returns the new ids and what was skipped (not a mesh, already one piece, or more than 500 pieces).",
    inputSchema: { ids: z.array(z.string()).min(1).describe("Ids of the mesh objects to split") },
  },
  ({ ids }) => run("split_loose_parts", { ids }),
);

server.registerTool(
  "merge_objects",
  {
    title: "Merge objects",
    description:
      "Join several shapes or imported models into ONE mesh object, like Blender's Ctrl+J. It stays where the parts were, takes the name, folder and material (metalness, roughness, glow) of the last id (the primary), and is axis-aligned (rotation 0). Every part keeps its own color (per-vertex colors, exported as palette UVs). For game export prefer a folder with model: true instead – the parts stay editable. Lights, nodes and holes are skipped (holes in the folder still cut the result). One undo step; split_loose_parts can split it again.",
    inputSchema: { ids: z.array(z.string()).min(2).describe("Ids of the objects to merge; the last one is the primary") },
  },
  ({ ids }) => run("merge_objects", { ids }),
);

server.registerTool(
  "export_glb",
  {
    title: "Export GLB",
    description:
      "Export visible objects as a binary glTF (.glb) file that Blender, Roblox Studio, Unity, Godot etc. can import. Folders become named groups; parts share palette materials (colors as pixels in <name>_palette.png, glow in <name>_emission.png, both also written next to the .glb); objects with a material name get their own material; marker nodes become empty nodes with their props as extras.",
    inputSchema: { path: z.string().describe("Absolute file path ending in .glb") },
  },
  ({ path }) => run("export_glb", { path }),
);

await server.connect(new StdioServerTransport());
log("MCP-server klar");

// Avslutt når Claude Code lukker forbindelsen, så porten ikke blir hengende opptatt.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
