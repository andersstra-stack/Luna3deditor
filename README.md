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
| Legg til form | Knappene midt i verktøylinja (havner der kameraet ser). **Flere** har kile, prisme (tak), pyramide, trapp, halvkule, rør, avrundet kube og lys |
| Velg | Klikk i 3D-visningen eller i scenelista. **Ctrl+klikk** velger flere, **Shift+klikk** i lista velger et område, **Ctrl+A** velger alt |
| Flytt / roter / skaler | Dra i gizmoen – bytt modus med **W / E / R** |
| Fest til objekter | **C** (på som standard): flater legger seg helt inntil hverandre og bakken når du flytter, uten mellomrom |
| Fest til rutenett | **X** (0,25 m / 15° / 0,1) |
| Kamera | Venstre mus roter · høyre mus panorer · hjul zoom · **F** vis alt |
| Plassering | Egenskapspanelet: **Legg ned på underlaget** (**End**), innrett flere objekter (min/midt/maks), speil og speilkopi. Mål på utvalget vises nede til venstre |
| Hull | Huk av **Hull** på et objekt, så skjæres det bort fra de andre objektene i samme mappe (vinduer, dører, hakk) – live og redigerbart |
| Lys | Punktlys og spotlys under **Flere**; farge og lysstyrke i egenskapspanelet. Roter spotlyset for å sikte |
| Nøyaktige verdier | Høyre panel – skriv inn tall eller dra i X/Y/Z-bokstaven (Shift = fint) |
| Mapper | Mappe-knappen i scenelista lager en mappe (inni den aktive). Dra objekter og mapper inn/ut, eller velg mappe i egenskapspanelet. Klikk en mappe for å velge alt i den (gizmoen flytter da hele mappa) – nye former havner også i den. Øyet skjuler hele mappa |
| Kopier / lim inn | **Ctrl+C** / **Ctrl+X** / **Ctrl+V** – via utklippstavla, så det virker også mellom to vinduer. Limes inn i den aktive mappa |
| Dupliser / slett | **Ctrl+D** / **Delete** |
| Angre / gjør om | **Ctrl+Z** / **Ctrl+Y** |
| Lagre / åpne | **Ctrl+S** / **Ctrl+O** (`.luna.json`) |
| Eksporter | Eksport-knappen → `.glb` (Blender, Roblox Studio, Unity, Godot …). Mappene blir navngitte grupper |

## Claude via MCP

`.mcp.json` registrerer MCP-serveren `luna3d` for Claude Code i denne mappa. Første gang du starter
Claude Code her blir du spurt om å godkjenne den. Når både Claude Code og appen kjører, lyser
«Claude tilkoblet» grønt øverst til høyre.

```
Claude Code ──stdio──▶ mcp-server/index.ts ──WebSocket 127.0.0.1:47317──▶ Luna 3D-appen
```

Verktøy Claude får: `get_scene`, `add_objects`, `update_objects`, `delete_objects`,
`create_folders`, `update_folders`, `delete_folders`, `select_objects`, `duplicate_objects`,
`drop_to_ground`, `align_objects`, `mirror_objects`,
`clear_scene`, `undo`, `redo`, `set_view`, `screenshot`, `save_scene`, `load_scene`, `export_glb`.

Alt Claude gjør kan angres med Ctrl+Z, og vises i statuslinja nederst.

`node mcp-server/smoke-test.mjs <prosjektmappe> <utmappe>` kjører en ende-til-ende-test mot appen
(den **tømmer scenen**, bygger et hus med vindu- og dørhull, tak, trapp, lys og et speilet bord, sjekker
resultatene og lagrer skjermbilder/GLB i utmappa).
