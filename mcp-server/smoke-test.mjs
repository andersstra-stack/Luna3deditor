// End-to-end test: start MCP-serveren som Claude Code ville gjort, og kall verktøyene.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";

const root = process.argv[2];
const outDir = process.argv[3];
const transport = new StdioClientTransport({ command: "node", args: ["mcp-server/index.ts"], cwd: root, stderr: "inherit" });
const client = new Client({ name: "e2e", version: "0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  console.log(`\n# ${name}${r.isError ? " (ERROR)" : ""}\n${text.slice(0, 600)}`);
  return r;
};

// Vent på at appen kobler til
for (let i = 0; i < 30; i++) {
  const r = await client.callTool({ name: "get_scene", arguments: {} });
  if (!r.isError) break;
  await new Promise((res) => setTimeout(res, 1000));
}

await call("clear_scene");
const ids = (r) => JSON.parse(r.content[0].text).map((x) => x.id);
const [bord, pynt] = ids(await call("create_folders", { folders: [{ name: "Bord" }, { name: "Pynt" }] }));
const [bein] = ids(await call("create_folders", { folders: [{ name: "Bein", parentId: bord }] }));
const leg = (n, x, z) => ({ type: "cylinder", name: `Bein ${n}`, position: [x, 0.36, z], scale: [0.06, 0.72, 0.06], color: "#4a3420", folderId: bein });
await call("add_objects", {
  objects: [
    { type: "box", name: "Bordplate", position: [0, 0.75, 0], scale: [1.6, 0.06, 0.9], color: "#a0703c", roughness: 0.6, folderId: bord },
    leg(1, 0.7, 0.38), leg(2, -0.7, 0.38), leg(3, 0.7, -0.38), leg(4, -0.7, -0.38),
    { type: "sphere", name: "Eple", position: [0.2, 0.86, 0.1], scale: [0.16, 0.16, 0.16], color: "#d8343a", roughness: 0.3, folderId: pynt },
    { type: "torus", name: "Smultring", position: [-0.3, 0.81, -0.1], scale: [0.2, 0.2, 0.2], color: "#e9a35b" },
  ],
});
const scene = await call("get_scene");
const objs = JSON.parse(scene.content[0].text).objects;
await call("update_objects", { updates: [{ id: objs.find((o) => o.name === "Eple").id, color: "#3fae49" }] });
await call("update_objects", { updates: [{ id: "finnes_ikke", color: "#000000" }] });
// Smultringen flyttes inn i Pynt, og en ulovlig sykel skal avvises
await call("update_objects", { updates: [{ id: objs.find((o) => o.name === "Smultring").id, folderId: pynt }] });
await call("update_folders", { updates: [{ id: bord, parentId: bein }] });
// Slett Bein-mappa (beina flyttes opp i Bord), sjekk, og angre
await call("delete_folders", { ids: [bein] });
const after = JSON.parse((await call("get_scene")).content[0].text);
console.log("bein etter sletting ligger i:", [...new Set(after.objects.filter((o) => o.name.startsWith("Bein")).map((o) => o.folderId))]);
await call("undo");

const shot = await call("screenshot", { view: "iso" });
const img = shot.content.find((c) => c.type === "image");
if (img) writeFileSync(`${outDir}/shot.png`, Buffer.from(img.data, "base64"));

await call("export_glb", { path: `${outDir}/bord.glb` });
// Les nodehierarkiet fra GLB-ens JSON-del
const glb = readFileSync(`${outDir}/bord.glb`);
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const tree = (i, d = 0) => [`${"  ".repeat(d)}${gltf.nodes[i].name}`, ...(gltf.nodes[i].children ?? []).flatMap((c) => tree(c, d + 1))];
console.log(["GLB-hierarki:", ...gltf.scenes[0].nodes.flatMap((n) => tree(n))].join("\n"));
await call("save_scene", { path: `${outDir}/bord.luna.json` });
await call("undo");
await call("redo");

await client.close();
