# Luna 3D – notater for Claude

Enkel 3D-editor (Tauri 2 + React 19 + react-three-fiber/drei + zustand). UI-tekst er på norsk;
MCP-verktøybeskrivelser er på engelsk.

## Arkitektur
- `src/store.ts` – all scenetilstand (zustand). Endringer går via `commit()` som legger forrige tilstand
  i angre-historikken. `updateObjectLive` er uten historikk (brukes under gizmo-/skrubbe-dra, med
  `pushHistory()` ved start).
- `src/types.ts` – `SceneObject` og `Folder`. Mapper er kun organisering (ingen transform); objekter peker på
  mappe via `folderId`, mapper på forelder via `parentId`. Hjelpere for tre/synlighet ligger i `src/folders.ts`.
  Scenefilen er versjon 2 (v1 uten mapper kan fortsatt åpnes). Rotasjon lagres i **grader**; primitiver er
  enhetsstore, så `scale` = størrelse i meter.
- `src/viewport/` – `Viewport.tsx` (Canvas, utvalg, lys; gizmoen sitter på et usynlig proxy-objekt midt i utvalget og
  overfører endringen til alle valgte), `geometries.ts` (delte geometrier per type), `snapping.ts` (objekt-snapping under dra),
  `csg.ts` (hull: three-bvh-csg, resultat i solidens lokale rom), `three-handle.ts` (three-tilstanden utenfor Canvas).
- `src/bounds.ts` – nøyaktige verdensbokser beregnet fra dataene (ikke fra 3D-visningen); brukes av snapping,
  plassering, målvisning og `get_scene`. `src/placement.ts` – til bakken, innrett, speil.
- Utvalg: `selectedIds` (siste = hovedvalget, se `primaryId`). Nye former legges i `types.ts` (SHAPES, størrelse,
  `SYMMETRIC_AXES` for speiling) og `geometries.ts` – alle må være enhetsstore, sentrert og lukkede (for CSG).
- Import: `src/importer.ts` (FBX/GLB/OBJ/STL via three-loaders → én `type: "mesh"` per mesh, normalisert til
  enhetsboksen, enhetsgjetting cm/mm → m, STL snus fra Z-opp). Teksturer (f.eks. lowpoly-fargepaletter) lastes i to runder via
  LoadingManager-URL-modifier fra samme mappe; fargen per trekant leses fra bildet og meshen deles opp per farge. Geometrien ligger i `src/meshes.ts` (register utenfor
  angre-historikken, base64 i scenefil v3 og i utklippstavla). Bruk alltid `geometryOf(o)`, ikke `getGeometry(o.type)`.
  FBX-enheten leses fra `UnitScaleFactor`; FBX snus 180° om Y (se `importModelData`) så eksportert GLB står likt med FBX-en i
  Unity. Empties blir noder; Custom Properties leses av `src/fbxProps.ts` (FBXLoader tar dem ikke med).
  «Del opp i løse deler»: `src/meshSplit.ts` (hjørner på samme sted regnes som felles; nye mesher i registeret, byttet inn
  med `store.replaceObjects` som ett angre-steg). «Slå sammen»: `src/meshMerge.ts` (baker geometrien i verdensrom, snur
  trekantene for speilede objekter, normaliserer igjen; én farge – hovedvalgets).
  Modeller speiles med negativ størrelse (de er ikke symmetriske); `add_objects` kan ikke lage `mesh` direkte.
- Python-skript: `scripting/luna3d.py` (API + `python -m luna3d skript.py`) samler endringer og skriver dem ut etter
  markøren `@@LUNA3D_OPS@@` når skriptet er ferdig. Kjøres av Rust (`run_python_script`, modulen pakkes som ressurs)
  eller MCP (`mcp-server/python.ts`); `src/scripting.ts` tolker utdata, `store.applyScript` gjør alt som ett angre-steg.
  Nye egenskaper/former må legges inn i både `luna3d.py` (PROPS/SHAPES) og appen. Objekter/mapper fra en skriptfil får
  `script` (normalisert sti, `scriptKey`); ny kjøring av samme fil erstatter dem (mapper med samme navn gjenbrukes).
  Kopier og innlimte objekter mister merket.
- Markør-noder: `type: "node"` (`MARKERS` i `types.ts`, hjelpere i `src/nodes.ts`) – usynlige punkter for spillmotoren, lokal
  +Z forover / +Y opp, egenskaper i `props` (glTF `extras`). Lys og noder er «hjelpere» (`isHelper`): ingen hull, snapping
  eller underlag. `scale` er bare markørstørrelsen; eksporten skriver noden uten skala. `extras` i GLB er eneste kilde
  (Unity/glTFast leser dem selv) – egenskapene er flate tall eller tekst, ingen sannhetsverdier.
- Kommentar-pinner: `notes` i `Snapshot` (angre-historikk) og scenefila. En pinne er festet til et objekt via
  `local` (objektets koordinater), se `src/notes.ts`. Vises som DOM (`viewport/Notes.tsx`, drei `Html`) og tegnes inn i
  skjermbilder i `captureViewport`. Når brukeren nevner pinner/kommentarer: `get_notes`, gjør jobben, `reply_to_note`
  med status `done`.
- `src/bridge/` – `protocol.ts` deles med MCP-serveren (ingen imports!), `commands.ts` er handlerne
  appen kjører, `useMcpBridge.ts` er WebSocket-klienten med auto-reconnect.
- `mcp-server/index.ts` – kjøres direkte av Node 24 (type stripping, ingen build): kun slettbar
  TS-syntaks, `.ts`-endelser i relative imports, logging kun til stderr.
- `src-tauri/src/lib.rs` – filkommandoer (`write_text_file`, `read_text_file`, `write_binary_file`) + dialog-plugin.

## Versjon og endringslogg
- Versjonen har én kilde: `package.json` (`tauri.conf.json` peker dit, Vite gir `__APP_VERSION__`, MCP-serveren leser den).
- Før inn meningsfulle endringer under `## [Unreleased]` i `CHANGELOG.md` (Keep a Changelog, norsk, samme stil som LunaChat).
- Ny versjon: `npm run bump -- patch|minor|major` (oppdaterer package.json, Cargo.toml og changelog), så commit + `git tag vX.Y.Z`.

## Tema
- `src/styles/theme.css` er kopiert ordrett fra LunaChat (`Lunadiscordclone/client/src/styles/theme.css`) – ikke endre
  temablokkene her; nye temaer legges inn der og kopieres. `App.css` mapper Luna-tokens (`--bg-1`, `--text` …) til
  LunaChat-variablene. Tema-tilstand i `src/ui/uiStore.ts` (`luna3d.theme` i localStorage + inline-skript i `index.html`).
- 3D-visningen har gjennomsiktig bakgrunn (temaets gradient synes); rutenett/utvalgsfarge avledes i `useThemeColors()`.

## Nytt MCP-verktøy
1. Legg metoden til `BRIDGE_METHODS` i `src/bridge/protocol.ts`.
2. Implementer handleren i `src/bridge/commands.ts`.
3. Registrer verktøyet i `mcp-server/index.ts`. Claude Code må koble MCP-serveren til på nytt.

## Sjekk
- `npx tsc --noEmit` (frontend), `cargo build` i `src-tauri`.
- `npm run tauri dev`, så `node mcp-server/smoke-test.mjs <prosjekt> <utmappe>` for ende-til-ende via MCP.

## Fallgruve
- Ikke skriv filer med Pythons tekstmodus på Windows – den lager CRLF. Repoet bruker LF (`.gitattributes`).
- I dev kan Vite ha to instanser av en modul etter hot reload (`store.ts` og `store.ts?t=…`). Ved testing fra
  nettleserkonsollen: importer URL-en appen faktisk bruker (se `performance.getEntriesByType("resource")`).
- `three-mesh-bvh` er tvunget til 0.9 via `overrides` (three-bvh-csg krever det; drei vil ha 0.8).
  Advarselen «maxLeafSize has been deprecated» kommer fra three-bvh-csg og er ufarlig.
- HTML-dra-og-slipp i scenelista krever `"dragDropEnabled": false` i `tauri.conf.json` (ellers tar WebView2 dra-hendelsene).
- Kun ett app-vindu kan være koblet til MCP-broen; flere avvises med lukkekode 4001 (`BRIDGE_BUSY_CODE`).
- Hot reload bytter ikke ut handlerne i en åpen WebSocket – last vinduet helt på nytt etter endringer i `src/bridge/`.
- Etter hot reload av `Viewport.tsx` kan gamle lys/skygger henge igjen i scenen (rare mørke felt på flater som
  ikke finnes etter full omlasting). Last vinduet helt på nytt før du feilsøker belysning.
- drei 10 `Outlines`: `screenspace`-grenene i shaderen er byttet om – uten `screenspace` er `thickness` i piksler.
