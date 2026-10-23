# Luna 3D

En enkel 3D-editor – som Blender, bare uten marerittet. Bygget med Tauri 2, React og Three.js,
og med en MCP-server slik at Claude kan se og endre scenen sammen med deg.

## Kom i gang

```bash
npm install
npm run tauri dev
```

## Bruk

Tema velges under **Innstillinger** (tannhjulet øverst til høyre): de samme 10 temaene som LunaChat.


| Handling | Hvordan |
|---|---|
| Legg til form | Knappene midt i verktøylinja (havner der kameraet ser). **Flere** har kile, prisme (tak), pyramide, trapp, halvkule, rør, avrundet kube og lys |
| Velg | Klikk i 3D-visningen eller i scenelista. **Ctrl+klikk** velger flere, **Shift+klikk** i lista velger et område, **Ctrl+A** velger alt |
| Flytt / roter / skaler | Dra i gizmoen – bytt modus med **W / E / R** |
| Fest til objekter | **C** (på som standard): flater legger seg helt inntil hverandre og bakken når du flytter, uten mellomrom |
| Fest til rutenett | **X** (0,25 m / 15° / 0,1) |
| Kamera | Venstre mus roter · midtknapp panorer · hjul zoom · **F** vis alt. **Fly fritt** som i Unity: hold høyre mus og se deg rundt, **W/A/S/D** fram/sidelengs, **Q/E** ned/opp, **Shift** fortere, hjulet endrer farten |
| Plassering | Egenskapspanelet: **Legg ned på underlaget** (**End**), innrett flere objekter (min/midt/maks), speil og speilkopi. Mål på utvalget vises nede til venstre |
| Hull | Huk av **Hull** på et objekt, så skjæres det bort fra de andre objektene i samme mappe (vinduer, dører, hakk) – live og redigerbart |
| Lavpoly | **Innstillinger → Former → Lavpoly** gir færre segmenter på runde former (en kule: 2 208 → 168 trekanter) – for spill. Gjelder visning, hull og GLB-eksport |
| Lys | Punktlys og spotlys under **Flere**; farge og lysstyrke i egenskapspanelet. Roter spotlyset for å sikte |
| Markør-noder | **Flere → Node**: usynlige, navngitte punkter med retning for spillmotoren (dokkepunkter, hardpoints, motorer, spawn …). Pila er «forover» (lokal +Z), pinnen «opp» (+Y). Egne egenskaper (tall eller tekst) i egenskapspanelet. Kopier får neste nummer (`hp_01` → `hp_02`), og panelet varsler om like navn og mellomrom |
| Nøyaktige verdier | Høyre panel – skriv inn tall eller dra i X/Y/Z-bokstaven (Shift = fint) |
| Mapper | Mappe-knappen i scenelista lager en mappe (inni den aktive). Dra objekter og mapper inn/ut, eller velg mappe i egenskapspanelet. Klikk en mappe for å velge alt i den (gizmoen flytter da hele mappa) – nye former havner også i den. Øyet skjuler hele mappa |
| Kopier / lim inn | **Ctrl+C** / **Ctrl+X** / **Ctrl+V** – via utklippstavla, så det virker også mellom to vinduer. Limes inn i den aktive mappa |
| Dupliser / slett | **Ctrl+D** / **Delete** |
| Angre / gjør om | **Ctrl+Z** / **Ctrl+Y** |
| Lagre / åpne | **Ctrl+S** / **Ctrl+O** (`.luna.json`) |
| Importer | **Ctrl+I**, importknappen eller dra filer inn i vinduet: **FBX, GLB/glTF, OBJ, STL**. Flere deler havner i en egen mappe, cm/mm skaleres til meter. Farger hentes fra materialer, hjørnefarger og teksturer/fargepaletter (bildet leses fra samme mappe – ved dra-og-slipp: dra modell og bilde inn sammen), og modellen deles opp i én del per farge. Modellen kan flyttes, skaleres, fargelegges, speiles og få hull, men ikke formredigeres. **Del opp i løse deler** i egenskapspanelet gjør bitene som ikke henger sammen til egne objekter, og **Slå sammen** (flere valgt) gjør dem til én modell igjen – med fargen til hovedvalget. Tomme noder (Empties) i FBX/GLB blir markør-noder med egenskapene sine. Med **Innstillinger → Behold filas origo** havner modellens origo i scenens origo, så interiør og eksteriør fra samme Blender-oppsett passer sammen. FBX snus 180° om Y, så GLB-eksporten står likt med FBX-en i Unity. `.gltf` med eksterne filer støttes ikke – bruk `.glb` |
| Python-skript | `</>`-knappen kjører en `.py`-fil som bygger/endrer scenen med `import luna3d as luna` (se `scripting/luna3d.py` og `scripting/eksempler/`). Ett angre-steg per kjøring. Kjøres samme fil igjen, erstattes forrige resultat («Løsne» i egenskapene beholder et objekt). Krever Python 3 |
| Kommentar-pinner | Pinneknappen eller **N**, klikk på et objekt/bakken og skriv hva som må gjøres. Fanen «Kommentarer» i venstre panel lister dem. Claude kan lese, svare og markere dem som løst – og sette egne (lilla) |
| Eksporter | Eksport-knappen → `.glb` (Blender, Roblox Studio, Unity, Godot …). Mappene blir navngitte grupper. Noder blir tomme noder med egenskapene som glTF `extras` |

## Versjoner

Gjeldende versjon står i statuslinja og under Innstillinger. Endringer føres i [CHANGELOG.md](CHANGELOG.md)
(Keep a Changelog + SemVer). Ny versjon:

```bash
npm run bump -- minor
```

`package.json` er eneste kilde – `tauri.conf.json` leser derfra, og skriptet oppdaterer `Cargo.toml` og endringsloggen.
Deretter commit og `git tag vX.Y.Z`.

## Claude via MCP

`.mcp.json` registrerer MCP-serveren `luna3d` for Claude Code i denne mappa. Første gang du starter
Claude Code her blir du spurt om å godkjenne den. Når både Claude Code og appen kjører, lyser
«Claude tilkoblet» grønt øverst til høyre.

```
Claude Code ──stdio──▶ mcp-server/index.ts ──WebSocket 127.0.0.1:47317──▶ Luna 3D-appen
```

Verktøy Claude får: `get_scene`, `add_objects`, `update_objects`, `delete_objects`,
`create_folders`, `update_folders`, `delete_folders`, `select_objects`, `duplicate_objects`,
`drop_to_ground`, `align_objects`, `mirror_objects`, `run_python`, `import_model`,
`get_notes`, `add_note`, `reply_to_note`, `delete_notes`,
`clear_scene`, `undo`, `redo`, `set_view`, `screenshot`, `save_scene`, `load_scene`, `export_glb`.

Alt Claude gjør kan angres med Ctrl+Z, og vises i statuslinja nederst.

`node mcp-server/smoke-test.mjs <prosjektmappe> <utmappe>` kjører en ende-til-ende-test mot appen
(den **tømmer scenen**, bygger et hus med vindu- og dørhull, tak, trapp, lys og et speilet bord, sjekker
resultatene og lagrer skjermbilder/GLB i utmappa).
