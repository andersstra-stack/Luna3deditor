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
- Detaljnivå: `geometryDetail` i `uiStore` («smooth»/«lowpoly», localStorage) styrer segmentene i `geometries.ts` (`SEGMENTS`);
  cachen og CSG-kopiene er per nivå, og `Scene` bruker nivået i nøkkelen så formene bygges på nytt ved bytte.
- Parametriske former: `taper` (sylinder) og `type: "curve"` (`src/curves.ts`) har geometri per objekt – bruk alltid
  `geometryOf(o)` og `geometryKey(o)` (cache-nøkkel, også i `csg.ts`). Kurverør lagrer punktene lokalt (sentrert, meter) og
  normaliseres som modeller; utad (MCP/Python, `get_scene`) er punktene i verdensrommet. `points`/`radius` i
  add/update regnes om i `store.ts` (`newCurveProps`, `withUpdate`). Boksen tas fra den glatte varianten.
- `three-handle.ts`: `raycast` (mot det som vises: CSG-resultat og animasjonspositur; hull/lys/noder hoppes over, like treff
  slås sammen, normalen interpoleres fra hjørnenormalene) og kamera (`frameObjects`, `setCamera`, `cameraState`/`restoreCamera`
  – skjermbilder med `focus`/`camera` setter brukerens kamera tilbake).
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
  trekantene for speilede objekter, normaliserer igjen). Hver del beholder fargen: `MeshAsset.colors` (sRGB-byte per hjørne,
  lineært `color`-attributt i geometrien, også gjennom CSG); «Del opp» gjør ensfargede biter til vanlige modeller igjen.
  Modeller speiles med negativ størrelse (de er ikke symmetriske). Egne former: `type: "mesh"` med `vertices`/`triangles`
  (formens eget rom; `position` = origo, `rotation` rundt det) i `src/customMesh.ts` – id-en er en hash av formen, så like
  former deles i registeret. Geometrien kan ikke oppdateres (lag nytt objekt). Skript med mer enn 25 nye objekter svarer
  Claude med antall (`compactScriptResult` i `commands.ts`), ikke id-er.
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
- Eksport: `src/io.ts` `buildGlb` (i minnet, testbar) + `exportGlb` (skriver filer). `src/palette.ts` lager palett- og
  glød-bildet (én piksel per farge+glød, `flipY = false`, UV med v = 0 øverst). Materialer deles per
  materialnavn + metall/ruhet/gjennomsiktighet; `emissive` (0–1) og `material` ligger på `SceneObject`.
  Mapper med `model: true` bakes til én mesh (én gruppe/primitive per materiale) i modellens rom: origo fra en node som
  heter «pivot», ellers midt under delene. Et objekt hører til nærmeste modell-mappe oppover (`modelOf`); modell-mapper
  inni modeller blir barn-mesher. Sjekk resultatet ved å lese GLB-ens JSON-del (nodene bruker `matrix`, ikke `translation`).
- Animasjon: `clips` i `Snapshot` (angre-historikk) og scenefila. `src/animation.ts` er felles matte for visning og eksport:
  nøkkelrammer er endringer fra hvile rundt målets pivot (`pivotFrame`: objektets midtpunkt, eller en node `pivot`/`pivot_02` i
  mappa, ellers midt under innholdet), `makeAnimator` gir `motion`/`folderMotion`/`objectWorld`. `src/animationPlayer.ts` er
  spilleren (ikke i scenen) og `currentPose()`; `useAnimatedPose` i `Viewport.tsx` setter matrisen rett på meshen (lys og
  noder: på gruppa, uten størrelse). Med et klipp valgt er gizmoen et opptak: proxyen står på posituren, og dra gir
  D' = F⁻¹·P⁻¹·Δ·P·F·D (`keyFromDelta` + `upsertKey`, live via `setClipsLive` med `pushHistory()` ved start).
  `keyFromDelta` velger den av de to XYZ-Euler-løsningene (og ±360) som ligger nærmest dagens verdi. Eksporten sampler 30 bilder/s til glTF-spor på nodenes `uuid` (alt samles
  under én `THREE.Scene`, ellers finner eksportøren bare nodene under første rot).
- `src-tauri/src/lib.rs` – filkommandoer (`write_text_file`, `read_text_file`, `write_binary_file`) + dialog-plugin.

## Versjon og endringslogg
- Versjonen har én kilde: `package.json` (`tauri.conf.json` peker dit, Vite gir `__APP_VERSION__`, MCP-serveren leser den).
- Før inn meningsfulle endringer under `## [Unreleased]` i `CHANGELOG.md` (Keep a Changelog, norsk, samme stil som LunaChat).
- Ny versjon: `npm run bump -- patch|minor|major` (oppdaterer package.json, Cargo.toml og changelog), så commit + `git tag vX.Y.Z`.
- Publisering: `./scripts/publish-release.sh "notat"` (Git Bash) bygger signert NSIS-installer med
  `~/.tauri/luna3d-updater.key`, laster opp til `/opt/lunachat/releases/luna3d/` (serveres som
  `lunaeco.no/updates/luna3d/`) og skriver `latest.json`. Serveradresse i `scripts/.env` (gitignored).
  Appen sjekker manifestet ved oppstart (`src/ui/UpdateButton.tsx`, tauri-plugin-updater). Mistes nøkkelen,
  må alle installasjoner installeres på nytt manuelt.

## Tema
- `src/styles/theme.css` er kopiert ordrett fra LunaChat (`Lunadiscordclone/client/src/styles/theme.css`) – ikke endre
  temablokkene her; nye temaer legges inn der og kopieres. `App.css` mapper Luna-tokens (`--bg-1`, `--text` …) til
  LunaChat-variablene. Tema-tilstand i `src/ui/uiStore.ts` (`luna3d.theme` i localStorage + inline-skript i `index.html`).
- 3D-visningen har gjennomsiktig bakgrunn (temaets gradient synes); rutenett/utvalgsfarge avledes i `useThemeColors()`.
- Tegneserie-visning: `toonView` i `uiStore` (localStorage). `SolidMesh` bytter til `meshToonMaterial` (`TOON_GRADIENT`, tre lystrinn)
  og legger på drei `Outlines` i `INK` (ikke på hull og plan; valgte får aksentfargen). Bare visning – eksporten er uendret.

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
