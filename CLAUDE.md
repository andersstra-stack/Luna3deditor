# Luna 3D – notater for Claude

Enkel 3D-editor (Tauri 2 + React 19 + react-three-fiber/drei + zustand). UI-tekst er på norsk;
MCP-verktøybeskrivelser er på engelsk.

## Arkitektur
- `src/store.ts` – all scenetilstand (zustand). Endringer går via `commit()` som legger forrige tilstand
  i angre-historikken. `updateObjectLive` er uten historikk (brukes under gizmo-/skrubbe-dra, med
  `pushHistory()` ved start).
- `src/types.ts` – `SceneObject`. Rotasjon lagres i **grader**; primitiver er enhetsstore, så `scale` = størrelse i meter.
- `src/viewport/` – `Viewport.tsx` (Canvas, gizmo, utvalg), `geometries.ts` (delte geometrier per type),
  `three-handle.ts` (tilgang til three-tilstanden utenfor Canvas: kamera-innramming, skjermbilde).
- `src/bridge/` – `protocol.ts` deles med MCP-serveren (ingen imports!), `commands.ts` er handlerne
  appen kjører, `useMcpBridge.ts` er WebSocket-klienten med auto-reconnect.
- `mcp-server/index.ts` – kjøres direkte av Node 24 (type stripping, ingen build): kun slettbar
  TS-syntaks, `.ts`-endelser i relative imports, logging kun til stderr.
- `src-tauri/src/lib.rs` – filkommandoer (`write_text_file`, `read_text_file`, `write_binary_file`) + dialog-plugin.

## Nytt MCP-verktøy
1. Legg metoden til `BRIDGE_METHODS` i `src/bridge/protocol.ts`.
2. Implementer handleren i `src/bridge/commands.ts`.
3. Registrer verktøyet i `mcp-server/index.ts`. Claude Code må koble MCP-serveren til på nytt.

## Sjekk
- `npx tsc --noEmit` (frontend), `cargo build` i `src-tauri`.
- `npm run tauri dev`, så `node mcp-server/smoke-test.mjs <prosjekt> <utmappe>` for ende-til-ende via MCP.

## Fallgruve
- drei 10 `Outlines`: `screenspace`-grenene i shaderen er byttet om – uten `screenspace` er `thickness` i piksler.
