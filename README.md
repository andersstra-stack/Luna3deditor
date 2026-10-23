# Luna 3D

En enkel 3D-editor – som Blender, bare uten marerittet. Bygget med Tauri 2, React og Three.js,
og med en MCP-server slik at Claude kan se og endre scenen sammen med deg.

## Kom i gang

```bash
npm install
npm run tauri dev
```

## Bruk

| Handling | Hvordan |
|---|---|
| Legg til form | Knappene midt i verktøylinja (havner der kameraet ser) |
| Velg | Klikk i 3D-visningen eller i scenelista |
| Flytt / roter / skaler | Dra i gizmoen – bytt modus med **W / E / R** |
| Fest til rutenett | **X** (0,25 m / 15° / 0,1) |
| Kamera | Venstre mus roter · høyre mus panorer · hjul zoom · **F** vis alt |
| Nøyaktige verdier | Høyre panel – skriv inn tall eller dra i X/Y/Z-bokstaven (Shift = fint) |
| Dupliser / slett | **Ctrl+D** / **Delete** |
| Angre / gjør om | **Ctrl+Z** / **Ctrl+Y** |
| Lagre / åpne | **Ctrl+S** / **Ctrl+O** (`.luna.json`) |
| Eksporter | Eksport-knappen → `.glb` (Blender, Roblox Studio, Unity, Godot …) |

## Claude via MCP

`.mcp.json` registrerer MCP-serveren `luna3d` for Claude Code i denne mappa. Første gang du starter
Claude Code her blir du spurt om å godkjenne den. Når både Claude Code og appen kjører, lyser
«Claude tilkoblet» grønt øverst til høyre.

```
Claude Code ──stdio──▶ mcp-server/index.ts ──WebSocket 127.0.0.1:47317──▶ Luna 3D-appen
```

Verktøy Claude får: `get_scene`, `add_objects`, `update_objects`, `delete_objects`, `select_object`,
`clear_scene`, `undo`, `redo`, `set_view`, `screenshot`, `save_scene`, `load_scene`, `export_glb`.

Alt Claude gjør kan angres med Ctrl+Z, og vises i statuslinja nederst.

`node mcp-server/smoke-test.mjs <prosjektmappe> <utmappe>` kjører en ende-til-ende-test mot appen
(den **tømmer scenen**, bygger et bord og lagrer skjermbilde/GLB i utmappa).
