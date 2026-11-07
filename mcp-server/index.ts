#!/usr/bin/env node
/**
 * Luna 3D MCP-server.
 *
 * Claude Code starter denne over stdio. Uten argumenter er den en tynn proxy (proxy.ts) som sender alt videre til
 * huben (hub.ts, `--hub`): én langlevende prosess som eier WebSocket-porten Luna 3D-vinduene kobler seg til, og som
 * tar imot én MCP-økt per Claude-økt. Slik kan flere økter jobbe samtidig, hver i sitt eget prosjektvindu.
 * Verktøyene defineres her og kjøres i huben. Kjøres direkte med Node (type stripping), uten byggesteg.
 *
 * NB: stdout tilhører MCP-protokollen – all logging går til stderr.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withImages } from "./images.ts";
import { runPythonScript } from "./python.ts";
import { Hub, bridge, currentCall, type ToolDef } from "./hub.ts";
import { runProxy } from "./proxy.ts";
import type { BridgeMethod } from "../src/bridge/protocol.ts";
import { ADDABLE_SHAPES } from "../src/types.ts";

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
  head: vec3.optional().describe("Bone only: WORLD point of the joint (root). Default for a new bone: the parent's tail."),
  tail: vec3.optional().describe("Bone only: WORLD point of the tip. head/tail replace position/rotation/scale."),
  roll: z.number().optional().describe("Bone only: twist around its own axis in degrees (default 0)."),
  parent: z.string().nullable().optional().describe("Bone only: id of the parent bone (null = root bone)."),
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
  uvs: z
    .array(z.tuple([z.number(), z.number()]))
    .optional()
    .describe("type 'mesh' only: one [u, v] per vertex, needed for texture and normal_map. v = 0 is the TOP of the image (glTF)."),
  texture: z.string().optional().describe("type 'mesh' or 'reference': absolute path to a PNG or JPEG image. On a mesh the object's color tints it (default white)."),
  height: z.number().positive().optional().describe("type 'reference' only: height of the image in meters (default 2); the width follows from the image."),
  normal_map: z.string().optional().describe("type 'mesh' only: absolute path to a PNG or JPEG normal map (OpenGL style, +Y up): fine detail without more triangles."),
  normal_scale: z.number().min(0).optional().describe("type 'mesh' only: strength of normal_map (default 1)."),
  roughness_map: z
    .string()
    .optional()
    .describe("type 'mesh' only: absolute path to a PNG or JPEG roughness map (grayscale: black = glossy, white = matte; the green channel is read), multiplied by 'roughness'."),
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
  reversed bottom). Its geometry can't be edited afterwards – make a new object. For detail finer than the vertices give
  'uvs' (one [u, v] per vertex, v = 0 at the top of the image) with 'texture', 'normal_map' and/or 'roughness_map'
  (absolute paths to PNG or JPEG, the normal map OpenGL style, +Y up; the roughness map grayscale, black = glossy, white =
  matte, multiplied by 'roughness' – wet lips, worn leather, oily skin) and optional 'normal_scale'. Vertex colors tint the
  image and still work with only a normal or roughness map. The images are stored in the scene and exported in the GLB. A texture or normal map costs one
  material per image, and such parts can't be merged or split.
- reference: an image to model from (photo, drawing). Give 'texture' (absolute path, PNG or JPEG) and 'height' in meters.
  It stands upright facing +Z (rotation [0, 90, 0] for a side view), half transparent ('opacity'), and keeps the image's
  own colors under any light. It shows in the viewport and in screenshots, so compare your model with it there, but it is
  saved only in the scene: never in the GLB or in icons, and snapping, holes and raycast ignore it. Put it behind the model.
- curve: a round tube along a smooth curve through 'points' (WORLD coordinates) with 'radius' (one number, or one per
  point to taper it) – branches, roots, cables, handles, tentacles, horns. Give points + radius instead of
  position/scale; get_scene returns its current world 'points' and 'radius'. Sending new points to update_objects
  reshapes it; sending only radius keeps it in place. Start a branch slightly INSIDE its parent (e.g. inside the trunk)
  so the joint looks grown, not glued on.
- pointLight / spotLight: light sources (spotLight shines along its local -Y; rotate it to aim). Use 'intensity' and 'color'.
- node: an invisible marker point for game engines (see "Marker nodes" below). 'scale' is only its size in the editor.
- bone: one bone of a skeleton (see "Skeletons" below). Give 'head' and 'tail' (WORLD points) and 'parent' (bone id).
To rest an object on the ground, set position.y = scale.y / 2 (planes: y = 0) — or call drop_to_ground.

get_scene returns each object's exact world-space bounding box ('bounds' min/max), which makes it easy to place
things flush against each other (e.g. new.position.x = other.bounds.max.x + new.scale.x / 2).

Export & materials (like the Nova library): export_glb writes ONE shared palette material per look – every color is a
pixel in <name>_palette.png (also embedded in the GLB) and each part's UVs point at its pixel. 'emissive' (0–1) makes a
part glow and goes into <name>_emission.png. Set material: 'nova_glass' on glass so Unity swaps in its glass shader;
imported models keep their material names from the file.

Lighting: set_lighting changes the scene's own light setup (presets standard, studio, overcast, evening, or individual
values). It affects the viewport, screenshots and render_icon but never the export, and it is saved with the scene.
Use 'studio' to judge organic forms or anything seen from behind; keep 'standard' in scenes that make icons, so they
stay consistent with earlier icons. pointLight/spotLight objects are for light that belongs to the scene itself (a lamp).

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
- luna.mesh(vertices=[...], triangles=[...], position=, rotation=, color=, vertex_colors=, smooth=, uvs=[(u, v), ...],
  texture="C:/path/color.png", normal_map="C:/path/normal.png", normal_scale=1, roughness_map="C:/path/rough.png") – custom shapes;
  luna.reference("C:/path/front.png", height=1.78, position=(0, 0.89, -0.5), rotation=(0, 0, 0), opacity=0.6) – image to model from;
  luna.orient(forward, up) -> rotation that points the shape's +Z along forward and +Y toward up (like nodes)
Large runs return only counts (not every id); use luna.objects(...) / get_scene to find objects afterwards.
- luna.folder(name, parent=None) -> key (use as folder=/parent=)
- luna.update(id_or_key, **props), luna.delete(*ids), luna.simplify(id_or_key, ratio=0.1 or triangles=5000) – fewer triangles
- luna.bone(name=, head=(x,y,z), tail=(x,y,z), parent=key, roll=, folder=) -> key; luna.skin(mesh_keys..., bones=[...]) binds
  meshes to the bones (default all) with automatic weights; luna.humanoid(mesh_keys..., folder=) builds a Mixamo-named
  skeleton for a T/A-pose character
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
game can rotate. Characters get a skeleton instead (see "Skeletons"). Keep parts as separate shapes in Luna while working
(easy to edit) – merging happens at export.

Skeletons (characters, creatures): add bones with add_objects type "bone", head = joint, tail = tip (WORLD points), parent =
the parent bone id; a child usually starts at its parent's tail. Typical humanoid (Y up, character facing +Z): hips (root,
at the pelvis, pointing up) > spine > chest > neck > head; upper_arm_L/R > lower_arm > hand from the shoulders; upper_leg_L/R >
lower_leg > foot from the hips (pointing down). Build one side and mirror_objects copy: true across x = 0 – the copies keep
the hierarchy and _L/_R names swap. Bones show through the mesh in the viewport. Then simplify_mesh the heavy meshes and
skin_mesh them (automatic weights; limit 'bones' for parts that must follow one bone rigidly, e.g. eyes/beard → head).
A bone's local +Y points to its tail, so keyframe rotations are around the joint in the bone's own axes (rotation x bends
most limbs forward/back); child bones follow their parents. Pose by setting keyframes on bones in a clip ("Idle", "Gå") and
check with preview_animation + screenshot. For a character in T-pose or A-pose, add_humanoid_skeleton builds the whole
skeleton with Mixamo names in one go, and import_animation puts Mixamo FBX animations (Idle, Walking, Waving …) on it –
the fastest way to a moving character. Moving bones WITHOUT a clip edits the rest pose (meshes don't follow – re-run
skin_mesh). export_glb writes the bones as a glTF skeleton (skin with joints and inverse bind matrices) and the clips as
bone animations; skinned meshes are separate skinned meshes, not baked into model folders.

Animation: named clips ("Åpne", "Snurr" …) with keyframes on objects or folders, exported as glTF animations that
the game plays by name (Unity/glTFast imports them as clips). Keys are OFFSETS from the rest pose, around the
target's pivot and in the pivot's axes, so the animation survives moving the object later: an object turns around its
own center; a folder turns around a marker node named "pivot" inside it (put it on the hinge/axle and rotate it so its
axes match the motion), else around the bottom center of its contents. Animate a door by putting its parts in a folder
with a pivot on the hinge and call animate(target=folder, preset="open", amount=95). Use animate for spin/sway/bob/open
and set_keyframes for anything else; preview_animation + screenshot to check a pose (e.g. halfway). In Python:
luna.animate(target, "spin", axis="y", amount=1, duration=2) and luna.keyframes(target, "Clip", [{"t": 0, ...}, ...]).
For export, a moving part must not be baked into an outer model folder: give it its own folder with model: true (it
becomes a child mesh), or keep it out of model folders.

Folders: purely organizational (like a file tree) — they have no transform of their own and can be nested.
For anything with more than a handful of parts, put parts in descriptive folders (e.g. "House" > "Roof", "Walls").
Create folders first with create_folders, then pass folderId in add_objects. Hidden folders hide everything inside them.

Helpers: duplicate_objects (repeat parts with an offset), mirror_objects (symmetric models: build one side, mirror-copy
across x = 0), align_objects, drop_to_ground. split_loose_parts splits imported meshes into their unconnected pieces
(like Blender's "Separate by Loose Parts") so single pieces can be moved, recolored or deleted; merge_objects joins
several shapes/meshes into one mesh inside Luna (like Ctrl+J; every part keeps its color, the rest of the look comes from
the primary). Prefer model folders for export – merged meshes can't be edited part by part. simplify_mesh lowers the
triangle count of meshes (ratio or triangles) and keeps UVs, colors and maps – do it before export for game models
(characters: roughly 10–40k triangles in total); in Python luna.simplify(key, ratio=0.1).

Seeing and placing precisely: screenshot with focus=[ids] (and zoom) or camera={position, target} gives close-ups
without disturbing the user's view. raycast finds surfaces: to put something ON a surface, shoot a ray toward it
(e.g. from outside the tree crown toward its center, or straight down onto a roof), place the object at the hit point
and orient it with the normal (in Python: luna.orient(forward=..., up=normal)).

Several projects: Luna 3D can have several projects open at once, one window each, and several Claude sessions can work
at the same time – every session works on ONE window, and the tools only touch that window. With a single window open
you get it automatically; otherwise call list_projects and use_project, or open_project to open a scene file in a new
window. Don't load_scene or clear_scene in a window the user or another session is working in – use open_project.

Workflow tips: call get_scene first to see existing objects and their ids. Build composite things from several shapes
with one add_objects call. Use screenshot to check your work visually — try different views. Every change is undoable by the user.`;

// Verktøyene samles her og registreres på nytt for hver MCP-økt i huben (én McpServer per økt).
const tools: ToolDef[] = [];
const server = {
  registerTool: ((name: string, config: unknown, handler: ToolDef["handler"]) => {
    tools.push({ name, config, handler });
  }) as unknown as McpServer["registerTool"],
};

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/**
 * Filoperasjoner og store skript kan ta lang tid på tunge scener. En GLB på 60 MB ble skrevet, men Claude fikk beskjed om
 * tidsavbrudd etter vanlig grense (20 s), og et slikt svar frister til å prøve på nytt.
 */
const SLOW_MS = 5 * 60_000;

async function run(method: BridgeMethod, params: Record<string, unknown> = {}, timeoutMs?: number) {
  try {
    return json(await bridge.call(method, params, timeoutMs));
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
  ({ objects }) => {
    try {
      return run("add_objects", { objects: withImages(objects) });
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }
  },
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
    description: "Move the user's camera so the whole scene – or just the 'focus' objects/folders – is framed from the given direction.",
    inputSchema: {
      view: z.enum(VIEWS).describe("'current' keeps the direction but re-frames."),
      focus: z.array(z.string()).optional().describe("Object or folder ids to frame instead of the whole scene."),
      zoom: z.number().positive().optional().describe("With focus: >1 closer, <1 further away (default 1)."),
    },
  },
  (p) => run("set_view", p),
);

server.registerTool(
  "set_lighting",
  {
    title: "Set scene lighting",
    description:
      "Set how the scene is lit in the viewport, screenshots and render_icon (not in the exported GLB). Stored in the scene file, undoable, and separate per project. 'preset' picks a ready-made setup; any other value is applied on top of it (or on top of the current setup) and makes it 'custom'. Call with no arguments to read the current values. See 'Lighting' in the instructions.",
    inputSchema: {
      preset: z.enum(["standard", "studio", "overcast", "evening"]).optional().describe("standard = Luna's normal light; studio = three-point light that shows form from every side; overcast = soft, no hard shadows; evening = low warm sun."),
      ambient: z.number().min(0).max(2).optional().describe("Even light from sky and ground (standard 0.9)."),
      sun: z.number().min(0).max(6).optional().describe("Main light, the only one casting shadows (standard 2.2)."),
      sun_azimuth: z.number().optional().describe("Sun direction in degrees around the scene: 0 = from the front (+Z), 90 = from +X, 180 = from behind. Fill and rim follow it."),
      sun_elevation: z.number().min(5).max(90).optional().describe("Sun height in degrees above the horizon."),
      sun_color: z.string().optional().describe("Hex color of the sun, e.g. '#ffb877'."),
      fill: z.number().min(0).max(3).optional().describe("Soft light from the opposite side of the sun, lifts the shadow side (no shadows)."),
      rim: z.number().min(0).max(4).optional().describe("Light from behind that draws the outline (no shadows)."),
      environment: z.number().min(0).max(2).optional().describe("Light from all around, with reflections in glossy surfaces."),
    },
  },
  (p) => run("set_lighting", p),
);

server.registerTool(
  "screenshot",
  {
    title: "Screenshot viewport",
    description:
      "Capture an image of the 3D viewport so you can see the scene. 'view' alone reframes the whole scene (and moves the user's view). For a close look use 'focus' (frame given objects/folders from 'view', with 'zoom') or 'camera' (exact position and look-at target) – the user's camera is put back afterwards unless keep_view is true.",
    inputSchema: {
      view: z.enum(VIEWS).optional().describe("Direction to look from. Omit (and omit focus/camera) to capture exactly what the user sees."),
      focus: z.array(z.string()).optional().describe("Object or folder ids to frame (close-up of a part)."),
      zoom: z.number().positive().optional().describe("With focus: >1 closer, <1 further away (default 1)."),
      camera: z
        .object({
          position: vec3.describe("Camera position in meters"),
          target: vec3.describe("Point the camera looks at"),
          fov: z.number().min(5).max(120).optional().describe("Field of view in degrees (default 50)"),
        })
        .optional(),
      keep_view: z.boolean().optional().describe("Leave the user's camera at the new place after a focus/camera shot."),
      width: z.number().int().min(256).max(1920).optional().describe("Max image width in pixels (default 1024)."),
    },
  },
  async ({ view, focus, zoom, camera, keep_view, width }) => {
    try {
      const shot = await bridge.call("screenshot", { view, focus, zoom, camera, keep_view, width });
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
  "render_icon",
  {
    title: "Render icon",
    description:
      "Render a square icon of objects/folders (e.g. an inventory or build-menu icon of a piece of furniture): transparent background, tight orthographic framing from 'view', and only the chosen shapes – no grid, shadow plane, nodes, light markers or the rest of the scene. Same lights and colors as the viewport. With 'path' it is saved as a PNG (missing folders are created). The user's camera is not changed. Returns the image so you can check it.",
    inputSchema: {
      ids: z.array(z.string()).optional().describe("Object or folder ids to include (default: everything visible)."),
      path: z.string().optional().describe("Absolute path ending in .png to save the icon to."),
      view: z.enum(VIEWS).optional().describe("Direction to look from (default 'iso' = front-right, slightly from above; 'current' is not allowed)."),
      size: z.number().int().min(16).max(2048).optional().describe("Width and height in pixels (default 256)."),
      padding: z.number().min(0).max(0.4).optional().describe("Empty margin on each side as a share of the image (default 0.06)."),
      background: z.string().optional().describe("Background color, e.g. '#1d2030'. Omit for a transparent PNG."),
    },
  },
  async ({ ids, path, view, size, padding, background }) => {
    try {
      const icon = await bridge.call("render_icon", { ids, path, view, size, padding, background });
      const note = icon.rendered < icon.size ? ` (rendered at ${icon.rendered}px and scaled up – make the Luna window bigger for sharper icons)` : "";
      return {
        content: [
          { type: "image" as const, data: icon.base64 as string, mimeType: "image/png" },
          {
            type: "text" as const,
            text: `${icon.size}×${icon.size}px, ${icon.objects} objects${icon.path ? `, saved to ${icon.path}` : ""}${note}`,
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }
  },
);

server.registerTool(
  "raycast",
  {
    title: "Raycast",
    description:
      "Shoot rays into the scene and get what they hit: point, surface normal (facing the ray), object id/name and distance – as rendered (holes cut, animation pose shown). Use it to put things ON surfaces: apples on foliage, lamps under a ceiling, a bird on a branch, decals on a hull. Holes, lights and nodes are ignored. Many rays in one call via 'rays'.",
    inputSchema: {
      origin: vec3.optional().describe("Ray start (single ray)."),
      direction: vec3.optional().describe("Ray direction (single ray, default [0, -1, 0] = straight down)."),
      rays: z
        .array(z.object({ origin: vec3, direction: vec3.optional(), max_distance: z.number().positive().optional() }))
        .optional()
        .describe("Several rays at once; the result is a list in the same order (null = no hit)."),
      max_distance: z.number().positive().optional(),
      ignore: z.array(z.string()).optional().describe("Object ids the rays pass through (e.g. the object you are placing)."),
      all: z.boolean().optional().describe("Return every hit along each ray (nearest first) instead of only the nearest."),
    },
  },
  (p) => run("raycast", p),
);

server.registerTool(
  "save_scene",
  {
    title: "Save scene",
    description: "Save the scene as a Luna 3D JSON file (.luna.json) at an absolute path.",
    inputSchema: { path: z.string().describe("Absolute file path, e.g. C:\\Users\\me\\Documents\\house.luna.json") },
  },
  ({ path }) => run("save_scene", { path }, SLOW_MS),
);

server.registerTool(
  "load_scene",
  {
    title: "Load scene",
    description:
      "Open a Luna 3D scene file (.luna.json) in this session's window, replacing its scene (undoable). To work on another file next to what is open, use open_project instead.",
    inputSchema: { path: z.string().describe("Absolute file path") },
  },
  ({ path }) => run("load_scene", { path }, SLOW_MS),
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
  ({ path, folderId, position, keep_origin }) => run("import_model", { path, folderId, position, keep_origin }, SLOW_MS),
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
        ? await bridge.call("apply_script", { ops: run.ops, name, script: scriptFile }, SLOW_MS)
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
  "skin_mesh",
  {
    title: "Skin mesh to skeleton",
    description:
      "Bind mesh objects (type 'mesh') to the skeleton with automatic weights (each vertex follows its nearest bones, max 4, smoothed across the surface), like Blender's 'With Automatic Weights'. Afterwards keyframes on the bones (set_keyframes, animate, preview_animation) deform the meshes, and export_glb writes a glTF skin. The current bones and mesh positions are the rest pose. Default: all bones in the scene; pass 'bones' to limit (e.g. only the head bone for a beard). Run it again after moving bones or changing the mesh. Simplify first – simplify_mesh on a skinned mesh re-skins it. One undo step.",
    inputSchema: {
      ids: z.array(z.string()).min(1).describe("Ids of the mesh objects to bind"),
      bones: z.array(z.string()).optional().describe("Bone ids to bind to (default: every bone in the scene)."),
    },
  },
  ({ ids, bones }) => run("skin_mesh", { ids, bones }, SLOW_MS),
);

server.registerTool(
  "add_humanoid_skeleton",
  {
    title: "Add humanoid skeleton",
    description:
      "Build a humanoid skeleton for a character that stands in T-pose or A-pose (Y up, facing +Z): 22 bones with Mixamo names (Hips, Spine, Spine1, Spine2, Neck, Head, Left/RightShoulder, Arm, ForeArm, Hand, Left/RightUpLeg, Leg, Foot, ToeBase), placed from the mesh itself (arms by a line fit, legs and spine by cross-sections, heights by Mixamo proportions). The names let import_animation put Mixamo animations on it and let Unity map it as a Humanoid. One undo step. Check with a screenshot, adjust single bones with update_objects head/tail if needed, then skin_mesh the meshes.",
    inputSchema: {
      ids: z.array(z.string()).min(1).describe("Mesh objects that make up the character"),
      folderId: z.string().optional().describe("Folder for the bones (default: a new folder 'Skjelett' next to the meshes)."),
    },
  },
  ({ ids, folderId }) => run("add_humanoid_skeleton", { ids, folderId }),
);

server.registerTool(
  "import_animation",
  {
    title: "Import animation",
    description:
      "Put an animation from a file (Mixamo FBX – 'Without Skin' or with – or a GLB/glTF with an animated skeleton) on the bones in the scene, matched by name (Mixamo names like Hips/LeftArm, with or without 'mixamorig:'). Each bone follows its source bone's rotation from the rest pose; a T-pose source fits an A-pose character, and the hip motion is scaled to the character's size. Becomes a normal clip (replaces one with the same name) that previews in the editor and exports in the GLB. Returns which bones matched.",
    inputSchema: {
      path: z.string().describe("Absolute path to the .fbx/.glb/.gltf file"),
      clip: z.string().optional().describe("Clip name (default: the file name, e.g. 'Walking')."),
      in_place: z.boolean().optional().describe("Remove forward/sideways travel (walk on the spot); height is kept."),
      loop: z.boolean().optional().describe("Loop in the editor preview (default true)."),
      fps: z.number().int().min(5).max(60).optional().describe("Keyframes per second (default 30)."),
      folderId: z.string().optional().describe("Only the bones in this folder (several characters with their own skeletons)."),
    },
  },
  ({ path, clip, in_place, loop, fps, folderId }) => run("import_animation", { path, clip, in_place, loop, fps, folderId }, SLOW_MS),
);

server.registerTool(
  "simplify_mesh",
  {
    title: "Simplify mesh",
    description:
      "Reduce the triangle count of mesh objects (type 'mesh': imported models and custom shapes), like Blender's Decimate – e.g. a sculpted character of a million triangles down to a game budget. UVs, vertex colors, texture, normal map and roughness map are kept, UV seams and hard edges are preserved, and small loose bits (single hair strands) may vanish. The object keeps its id, place, size, pins and animations; one undo step. Give ratio OR triangles. Returns before/after per object and the largest deviation from the original shape in millimeters – check with a screenshot (focus) afterwards. Objects that share one shape are simplified once.",
    inputSchema: {
      ids: z.array(z.string()).min(1).describe("Ids of the mesh objects to simplify"),
      ratio: z.number().gt(0).max(1).optional().describe("Share of the triangles to keep, e.g. 0.1 = 10 %."),
      triangles: z.number().int().min(1).optional().describe("Number of triangles to keep (per object) instead of ratio."),
      max_error: z
        .number()
        .positive()
        .optional()
        .describe("Stop before the shape deviates more than this share of the object's size (default 0.05 = 5 %), even if the target is not reached. Lower it to protect details."),
    },
  },
  ({ ids, ratio, triangles, max_error }) => run("simplify_mesh", { ids, ratio, triangles, max_error }, SLOW_MS),
);

const axisEnum = z.enum(["x", "y", "z"]);
const keyframe = z.object({
  t: z.number().min(0).describe("Seconds from the start of the clip."),
  position: vec3.optional().describe("Offset in meters from the rest position, in the pivot's axes."),
  rotation: vec3.optional().describe("Rotation in DEGREES around the pivot (XYZ, pivot's axes); interpolated linearly, so 360 = one full turn."),
  scale: vec3.optional().describe("Scale factor (1 = unchanged)."),
  ease: z.enum(["linear", "smooth"]).optional().describe("Easing from this key to the next (default linear)."),
});

server.registerTool(
  "animate",
  {
    title: "Animate (preset)",
    description:
      "Add a ready-made motion to an object or a folder: spin (amount = turns, loops), sway (amount = degrees back and forth, loops), bob (amount = meters up and down, loops) or open (amount = degrees; makes the clips 'Åpne' and 'Lukke'). Replaces the target's track in a clip with the same name. See 'Animation' in the instructions.",
    inputSchema: {
      target: z.string().describe("Object id or folder id. A folder moves around its marker node named 'pivot' (hinge/axle), else the bottom center of its contents."),
      preset: z.enum(["spin", "sway", "bob", "open"]),
      axis: axisEnum.optional().describe("Axis in the pivot's own axes (defaults: spin y, sway z, bob y, open y)."),
      amount: z.number().optional().describe("Turns (spin), degrees (sway/open) or meters (bob). Negative = the other way."),
      duration: z.number().positive().optional().describe("Seconds (defaults: spin 2, sway 3, bob 1, open 1)."),
      clip: z.string().optional().describe("Clip name (defaults: Snurr, Svai, Hopp, Åpne + Lukke). Clips are played by name in the game."),
    },
  },
  (p) => run("animate", p),
);

server.registerTool(
  "set_keyframes",
  {
    title: "Set keyframes",
    description:
      "Set your own keyframes for one target (object or folder) in a named clip (created if missing; the target's old track in it is replaced). Keys are offsets from the rest pose around the target's pivot.",
    inputSchema: {
      clip: z.string().describe("Clip name, e.g. 'Åpne', 'Idle', 'Spin'"),
      target: z.string().describe("Object id or folder id"),
      keys: z.array(keyframe).min(1),
      duration: z.number().positive().optional().describe("Clip length in seconds (default: the last key's t, or the clip's current length)."),
      loop: z.boolean().optional(),
    },
  },
  (p) => run("set_keyframes", p),
);

server.registerTool(
  "get_animations",
  {
    title: "Get animations",
    description: "List all animation clips with their tracks (target id and name) and keyframes.",
    inputSchema: {},
  },
  () => run("get_animations"),
);

server.registerTool(
  "delete_animations",
  {
    title: "Delete animations",
    description: "Delete whole clips (by name or id), or remove every track of one target from all clips.",
    inputSchema: {
      clips: z.array(z.string()).optional(),
      target: z.string().optional().describe("Object or folder id whose animation should be removed everywhere."),
    },
  },
  (p) => run("delete_animations", p),
);

server.registerTool(
  "preview_animation",
  {
    title: "Preview animation",
    description:
      "Show a clip in the editor at a given time (then call screenshot to see the pose), or play it. clip: null shows the rest pose again. Only the editor view changes – nothing in the scene.",
    inputSchema: {
      clip: z.string().nullable().describe("Clip name or id; null = rest pose"),
      time: z.number().min(0).optional().describe("Seconds (default 0)"),
      play: z.boolean().optional().describe("true = start playing from 'time'"),
    },
  },
  (p) => run("preview_animation", p),
);

server.registerTool(
  "export_glb",
  {
    title: "Export GLB",
    description:
      "Export visible objects as a binary glTF (.glb) file that Blender, Roblox Studio, Unity, Godot etc. can import. Folders become named groups; parts share palette materials (colors as pixels in <name>_palette.png, glow in <name>_emission.png, both also written next to the .glb); objects with a material name get their own material; marker nodes become empty nodes with their props as extras.",
    inputSchema: { path: z.string().describe("Absolute file path ending in .glb") },
  },
  ({ path }) => run("export_glb", { path }, SLOW_MS),
);

// ---------- Prosjekter (kjøres i huben, ikke i appen) ----------

async function local(fn: (call: ReturnType<typeof currentCall>) => unknown) {
  try {
    return json(await fn(currentCall()));
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
}

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description:
      "List the Luna 3D projects that are open (one window each): project id, scene file, how many Claude sessions work in it, and which one THIS session works on. Read-only.",
    inputSchema: {},
  },
  () => local(({ hub, session }) => hub.listProjects(session)),
);

server.registerTool(
  "use_project",
  {
    title: "Use project",
    description:
      "Make this session work on an open project (window). All other tools then act on it; other sessions keep theirs. Not needed when only one window is open.",
    inputSchema: { project: z.string().describe("Project id from list_projects, or the scene file path / file name") },
  },
  ({ project }) => local(({ hub, session }) => hub.useProject(session, project)),
);

server.registerTool(
  "open_project",
  {
    title: "Open project",
    description:
      "Open a scene file in a NEW Luna 3D window (or an empty window without 'path') and make this session work on it. Use this instead of load_scene when the current window belongs to the user or another session. A file that is already open is just selected.",
    inputSchema: { path: z.string().optional().describe("Absolute path to a .luna.json scene file") },
  },
  ({ path }) => local(({ hub, session }) => hub.openProject(session, path)),
);

if (process.argv.includes("--hub")) new Hub(tools, INSTRUCTIONS).start();
else await runProxy();
