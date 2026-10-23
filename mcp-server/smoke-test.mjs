// End-to-end test: start MCP-serveren som Claude Code ville gjort, og kall verktøyene.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";

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
await call("add_objects", {
  objects: [
    { type: "box", name: "Bordplate", position: [0, 0.75, 0], scale: [1.6, 0.06, 0.9], color: "#a0703c", roughness: 0.6 },
    { type: "cylinder", name: "Bein 1", position: [0.7, 0.36, 0.38], scale: [0.06, 0.72, 0.06], color: "#4a3420" },
    { type: "cylinder", name: "Bein 2", position: [-0.7, 0.36, 0.38], scale: [0.06, 0.72, 0.06], color: "#4a3420" },
    { type: "cylinder", name: "Bein 3", position: [0.7, 0.36, -0.38], scale: [0.06, 0.72, 0.06], color: "#4a3420" },
    { type: "cylinder", name: "Bein 4", position: [-0.7, 0.36, -0.38], scale: [0.06, 0.72, 0.06], color: "#4a3420" },
    { type: "sphere", name: "Eple", position: [0.2, 0.86, 0.1], scale: [0.16, 0.16, 0.16], color: "#d8343a", roughness: 0.3 },
    { type: "torus", name: "Smultring", position: [-0.3, 0.81, -0.1], scale: [0.2, 0.2, 0.2], color: "#e9a35b" },
  ],
});
const scene = await call("get_scene");
const objs = JSON.parse(scene.content[0].text).objects;
await call("update_objects", { updates: [{ id: objs.find((o) => o.name === "Eple").id, color: "#3fae49" }] });
await call("update_objects", { updates: [{ id: "finnes_ikke", color: "#000000" }] });

const shot = await call("screenshot", { view: "iso" });
const img = shot.content.find((c) => c.type === "image");
if (img) writeFileSync(`${outDir}/shot.png`, Buffer.from(img.data, "base64"));

await call("export_glb", { path: `${outDir}/bord.glb` });
await call("save_scene", { path: `${outDir}/bord.luna.json` });
await call("undo");
await call("redo");

await client.close();
