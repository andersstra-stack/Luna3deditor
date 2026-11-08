#!/usr/bin/env node
// Starter en testhub på egne porter (WebSocket 47417, MCP 47418) med koden i repoet, ved siden av den vanlige huben.
// Appen kobles dit med ?bridge=47417 (nettleser) eller launch-oppsettet «tauri-test». Logg: ~/.luna3d/hub-47418.log.
// Stopp med Ctrl+C. Bruk: npm run testhub
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const index = fileURLToPath(new URL("../mcp-server/index.ts", import.meta.url));
const child = spawn(process.execPath, [index, "--hub"], {
  env: { ...process.env, LUNA_BRIDGE_PORT: "47417", LUNA_HUB_PORT: "47418" },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
