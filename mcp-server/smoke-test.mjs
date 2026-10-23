// End-to-end-test: starter MCP-serveren slik Claude Code gjør, og bruker verktøyene mot appen.
// NB: tømmer scenen! Bruk: node mcp-server/smoke-test.mjs <prosjektmappe> <utmappe>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";

const [root, outDir] = process.argv.slice(2);
const transport = new StdioClientTransport({ command: "node", args: ["mcp-server/index.ts"], cwd: root, stderr: "inherit" });
const client = new Client({ name: "smoke-test", version: "0" });
await client.connect(transport);
console.log("verktøy:", (await client.listTools()).tools.map((t) => t.name).join(", "));

let failures = 0;
const call = async (name, args = {}, { expectError = false, quiet = false } = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const ok = !!r.isError === expectError;
  if (!ok) failures++;
  if (!quiet || !ok) console.log(`${ok ? "✓" : "✗"} ${name}${r.isError ? ` → ${text}` : ""}`);
  return { r, data: r.isError ? null : tryJson(text) };
};
const tryJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const check = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const scene = async () => (await call("get_scene", {}, { quiet: true })).data;
const byName = (s, name) => s.objects.find((o) => o.name === name);

// Vent på at appen kobler til
for (let i = 0; i < 30; i++) {
  if (!(await client.callTool({ name: "get_scene", arguments: {} })).isError) break;
  await new Promise((res) => setTimeout(res, 1000));
}

await call("clear_scene");

// --- Mapper og hus med hull ---
const [hus] = (await call("create_folders", { folders: [{ name: "Hus" }] })).data.map((f) => f.id);
const [vegg, tak] = (await call("create_folders", { folders: [{ name: "Fremvegg", parentId: hus }, { name: "Tak", parentId: hus }] })).data.map(
  (f) => f.id,
);
await call("add_objects", {
  objects: [
    { type: "box", name: "Vegg", position: [0, 1.25, 0], scale: [4, 2.5, 0.2], color: "#d9c8a9", folderId: vegg },
    { type: "box", name: "Vindu", position: [-1, 1.4, 0], scale: [0.9, 0.8, 0.5], hole: true, folderId: vegg },
    { type: "box", name: "Dør", position: [1, 1, 0], scale: [0.9, 2, 0.5], hole: true, folderId: vegg },
    { type: "prism", name: "Saltak", position: [0, 3.5, -1.5], scale: [4.4, 2, 3.4], rotation: [0, 90, 0], color: "#a2453a", folderId: tak },
    { type: "stairs", name: "Trapp", position: [2.2, 3, 1.2], scale: [1, 0.6, 1.2], color: "#8a8a8a" },
    { type: "pointLight", name: "Lampe", position: [-1.5, 3, 2.5], color: "#ffd9a0", intensity: 30 },
    { type: "hemisphere", name: "Kuppel", position: [-3, 0.25, 2], color: "#7dcfff" },
    { type: "tube", name: "Pipe", position: [1.2, 4.6, -1.5], scale: [0.4, 1, 0.4], color: "#555555", folderId: tak },
  ],
});

let s = await scene();
check("8 objekter, 3 mapper", s.objects.length === 8 && s.folders.length === 3, `${s.objects.length}/${s.folders.length}`);
check("get_scene har bounds", Array.isArray(byName(s, "Vegg").bounds?.min));
check("vindu er hull", byName(s, "Vindu").hole === true);
check("lampe har lysstyrke", byName(s, "Lampe").intensity === 30);

// --- Plasseringshjelp ---
await call("drop_to_ground", { ids: [byName(s, "Trapp").id] });
s = await scene();
check("trappa står på bakken", near(byName(s, "Trapp").bounds.min[1], 0), `bunn ${byName(s, "Trapp").bounds.min[1]}`);

// Bord: plate + bein, dupliser og speil
const [bord] = (await call("create_folders", { folders: [{ name: "Bord" }] })).data.map((f) => f.id);
await call("add_objects", {
  objects: [
    { type: "roundedBox", name: "Bordplate", position: [0, 0.75, 3], scale: [1.4, 0.06, 0.8], color: "#a0703c", folderId: bord },
    { type: "cylinder", name: "Bein", position: [0.6, 0.36, 3.3], scale: [0.06, 0.72, 0.06], color: "#4a3420", folderId: bord },
  ],
});
s = await scene();
const [bein2] = (await call("duplicate_objects", { ids: [byName(s, "Bein").id], offset: [0, 0, -0.6] })).data.map((c) => c.id);
s = await scene();
const mirrored = (await call("mirror_objects", { ids: [byName(s, "Bein").id, bein2], axis: "x", copy: true })).data.ids;
s = await scene();
const legs = s.objects.filter((o) => o.name.startsWith("Bein"));
check("4 bordbein etter dupliser + speilkopi", legs.length === 4, legs.map((l) => l.position[0]).join(", "));
check("speilkopier ligger på x = -0.6", mirrored.every((id) => near(s.objects.find((o) => o.id === id).position[0], -0.6)));

// Speiling av asymmetrisk form: kile om Y skal snus opp ned
await call("add_objects", { objects: [{ type: "wedge", name: "Kile", position: [3, 0.5, 3], color: "#bb9af7" }] });
s = await scene();
await call("mirror_objects", { ids: [byName(s, "Kile").id], axis: "y" });
s = await scene();
check("kile speilet om Y er snudd 180° om X", near(Math.abs(byName(s, "Kile").rotation[0]), 180, 0.1), byName(s, "Kile").rotation.join(", "));

// Innrett: kuppelen sin bunn til bordplatens bunn? Nei – innrett kuppel og kile på Z-midten etter kilen
await call("align_objects", { ids: [byName(s, "Kuppel").id, byName(s, "Kile").id], axis: "z", mode: "center" });
s = await scene();
check("innrettet på z", near(byName(s, "Kuppel").position[2], byName(s, "Kile").position[2]));

// Feil skal gi feilmelding
await call("align_objects", { ids: ["finnes_ikke", byName(s, "Kile").id], axis: "x", mode: "min" }, { expectError: true });
await call("select_objects", { ids: [byName(s, "Vegg").id, byName(s, "Saltak").id] });
s = await scene();
check("to valgt", s.selectedIds.length === 2);
await call("select_objects", { ids: [] });

// --- Bilde og eksport ---
const shot = await call("screenshot", { view: "iso" });
const img = shot.r.content.find((c) => c.type === "image");
if (img) writeFileSync(`${outDir}/shot.png`, Buffer.from(img.data, "base64"));
const front = await call("screenshot", { view: "front" });
const img2 = front.r.content.find((c) => c.type === "image");
if (img2) writeFileSync(`${outDir}/front.png`, Buffer.from(img2.data, "base64"));

await call("export_glb", { path: `${outDir}/hus.glb` });
const glb = readFileSync(`${outDir}/hus.glb`);
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const tree = (i, d = 0) => [`${"  ".repeat(d)}${gltf.nodes[i].name}`, ...(gltf.nodes[i].children ?? []).flatMap((c) => tree(c, d + 1))];
const lines = gltf.scenes[0].nodes.flatMap((n) => tree(n));
console.log(["GLB-hierarki:", ...lines].join("\n"));
check("hull og lys er ikke med i GLB", !lines.some((l) => /Vindu|Dør|Lampe/.test(l)));
const veggMesh = gltf.meshes[gltf.nodes.find((n) => n.name === "Vegg").mesh];
const veggVerts = gltf.accessors[veggMesh.primitives[0].attributes.POSITION].count;
check("veggen har hull skåret ut (mer enn 24 hjørner)", veggVerts > 24, `${veggVerts} hjørner`);

await call("save_scene", { path: `${outDir}/hus.luna.json` });
await call("undo");
await call("redo");

console.log(failures ? `\n${failures} FEIL` : "\nAlt OK");
await client.close();
process.exit(failures ? 1 : 0);
