# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versjonering: [Semantic Versioning](https://semver.org/).

Endringer skrives under [Unreleased] ved hver meningsfull commit. Ny versjon: `npm run bump -- minor`
(eller `patch`/`major`), så commit og `git tag vX.Y.Z`.

---

## [Unreleased]

### Added
- **Egen titellinje** (som LunaChat): Windows-rammen er fjernet og erstattet av en temafarget tittelrad med merke,
  scenens filnavn i midten og minimer/maksimer/lukk. Verktøyene ligger på egen rad under. Tittelraden flytter
  vinduet (dobbeltklikk maksimerer), og tittelen i oppgavelinja følger scenen.
- **Python-skript**: `.py`-filer kan bygge og endre scenen via modulen `luna3d` (løkker, matematikk, gjenbruk).
  Kjøres med `</>`-knappen i appen eller av Claude (MCP `run_python`, kan også lagre skriptet). Hele kjøringen
  er ett angre-steg, og et skript som feiler endrer ingenting. Eksempler i `scripting/eksempler/`.
  Kjøres samme skriptfil igjen, **erstattes** forrige resultat (mappene gjenbrukes, egne tillegg i dem blir
  liggende). Egenskapspanelet viser hvilket skript et objekt kommer fra, og «Løsne» beholder det.

## [0.6.0] — 2026-10-23

### Added
- **Temavelger** med de samme 10 temaene som LunaChat (Blå, Mørk, Lys, Lilla, Nord, Dracula, Gruvbox,
  Tokyo Night, Solarized, Skog) – identiske variabelnavn, glasspaneler over gradientbakgrunn. Valget huskes,
  og settes før appen tegnes (ingen blink). 3D-visningen følger temaet (bakgrunn, rutenett, utvalgsfarge).
- **Innstillinger** (tannhjul i verktøylinja) med utseende og «Om Luna 3D».
- **Versjonsnummer** med én kilde (`package.json`), vist i statuslinja og innstillingene; `npm run bump`
  oppdaterer package.json, Cargo.toml og endringsloggen.

## [0.5.0] — 2026-10-23

### Added
- Import av **FBX, GLB/glTF, OBJ og STL** (Ctrl+I, importknapp, dra-og-slipp, MCP `import_model`).
  Hver mesh blir et eget «Modell»-objekt, flere deler havner i en egen mappe.
- Farger fra materialer, hjørnefarger og teksturer/fargepaletter (lowpoly) – modellen deles per farge.
- Enhetsgjetting (cm/mm → meter), STL snus fra Z-opp.
- Scenefil versjon 3 med modellgeometri.

## [0.4.0] — 2026-10-23

### Added
- **Kopier / klipp ut / lim inn** objekter (Ctrl+C / Ctrl+X / Ctrl+V) via systemets utklippstavle,
  også mellom to vinduer.

## [0.3.1] — 2026-10-23

### Fixed
- Punktlys mørkla bakken helt ut i horisonten; bakken viser nå bare solskygger.

## [0.3.0] — 2026-10-23

### Added
- **Snapping**: former legger seg inntil hverandre og bakken når de flyttes.
- **Flervalg** og flytting av hele mapper med gizmoen.
- **Plasseringshjelp**: legg ned på underlaget, innrett, speil og speilkopi, mål på utvalget.
- **Nye former** (kile, prisme, pyramide, trapp, halvkule, rør, avrundet kube) og **lys** (punkt- og spotlys).
- **Hull (CSG)**: objekter merket som hull skjæres live bort fra andre objekter i samme mappe.
- MCP: `select_objects`, `duplicate_objects`, `drop_to_ground`, `align_objects`, `mirror_objects`, bounds i `get_scene`.

## [0.2.0] — 2026-10-23

### Added
- **Mapper** i scenelista: nestede, dra-og-slipp, skjul/vis, aktiv mappe. Mapper blir grupper i GLB-eksport.
- MCP: `create_folders`, `update_folders`, `delete_folders`.

## [0.1.0] — 2026-10-23

### Added
- Første versjon: Tauri 2 + React + Three.js med primitiver, gizmo, sceneliste, egenskapspanel,
  angre/gjør om, lagre/åpne `.luna.json` og GLB-eksport.
- MCP-server så Claude kan bygge, endre og ta skjermbilde av scenen.
