#!/usr/bin/env node
// Kaller MCP-verktøy fra skallet, som en Claude-økt – til testing og feilsøking. Standard er testhuben (port 47418);
// LUNA_HUB_PORT=47318 går mot den vanlige huben.
//
//   node mcp-server/call.mjs get_scene
//   node mcp-server/call.mjs screenshot '{"view":"iso"}' bilde.png        (bilder lagres til fil)
//   node mcp-server/call.mjs batch '[["use_project",{"project":"x"}],["get_scene",{}]]'
//   node mcp-server/call.mjs add_objects @objekter.json                    (@fil: argumentene fra en fil)
//
// FULL=1 skriver ut lange svar helt (ellers kuttes de etter 4000 tegn).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, writeFileSync } from "node:fs";

const [tool, rawArgs = "{}", out] = process.argv.slice(2);
if (!tool) {
  console.error("Bruk: node mcp-server/call.mjs <verktøy|batch> ['<json>'|@fil] [bilde.png]");
  process.exit(1);
}
const args = rawArgs.startsWith("@") ? readFileSync(rawArgs.slice(1), "utf8") : rawArgs;
const port = Number(process.env.LUNA_HUB_PORT ?? 47418);
const client = new Client({ name: "call", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
const calls = tool === "batch" ? JSON.parse(args) : [[tool, JSON.parse(args)]];
let images = 0;
let failed = false;
for (const [name, a] of calls) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: a }, undefined, { timeout: 600_000 });
  for (const c of r.content) {
    if (c.type === "image") {
      const file = (out ?? `${name}.png`).replace(/\.png$/i, images++ ? `_${images}.png` : ".png");
      writeFileSync(file, Buffer.from(c.data, "base64"));
      console.log(`[bilde → ${file}]`);
    } else console.log(process.env.FULL || c.text.length <= 4000 ? c.text : `${c.text.slice(0, 4000)}…`);
  }
  console.log(`(${name}: ${Date.now() - t0} ms${r.isError ? ", FEIL" : ""})`);
  failed ||= !!r.isError;
}
await client.close();
process.exit(failed ? 1 : 0);
