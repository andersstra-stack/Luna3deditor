# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versjonering: [Semantic Versioning](https://semver.org/).

Endringer skrives under [Unreleased] ved hver meningsfull commit. Ny versjon: `npm run bump -- minor`
(eller `patch`/`major`), så commit og `git tag vX.Y.Z`.

---

## [Unreleased]

## [0.11.0] — 2026-10-26

### Added
- **Palett-tekstur i GLB-eksporten**, som i Nova-biblioteket: hver farge blir én piksel i `<navn>_palette.png`
  (8×8, større ved behov), delene får UV-er som peker på sin piksel og deler felles materialer – ett per utseende
  (metall/ruhet/gjennomsiktighet). Bildet ligger inne i GLB-en og skrives også ved siden av.
- **Glød** per objekt (egenskapspanelet, MCP/Python `emissive` 0–1): delen lyser i sin egen farge, og gløden eksporteres
  som `<navn>_emission.png`.
- **Materialnavn** per objekt (f.eks. `nova_glass`, så Unity bytter inn sitt glass). Importerte modeller beholder
  materialnavnene fra fila.

### Changed
- **Ryddigere verktøylinje**: alle former, lys og markører ligger nå bak én «Legg til»-knapp. Flytt/roter/skaler,
  festing, kommentar-pinne og «vis alt» er flyttet til et flytende panel oppe til venstre i 3D-visningen.

## [0.10.0] — 2026-10-23

### Added
- **Lavpoly-former** (Innstillinger → Former): færre segmenter på kuler, sylindre, kjegler, smultringer, kapsler, rør og
  avrundede kuber – for spill. Gjelder visning, hull, «Slå sammen» og GLB-eksport. Den detaljerte senga går fra ca.
  191 000 til 20 000 trekanter.
- **Slå sammen** (egenskapspanelet ved flervalg og MCP `merge_objects`), som Ctrl+J i Blender: valgte former og modeller
  blir én modell på samme sted, med navn, mappe og utseende fra hovedvalget. Bitene fra «Del opp i løse deler» får
  tilbake navnet sitt. Lys, noder og hull blir ikke med.
- **Del opp i løse deler** for importerte modeller (egenskapspanelet og MCP `split_loose_parts`), som «Separate by
  Loose Parts» i Blender: bitene som ikke henger sammen blir egne objekter (`navn.1`, `navn.2` …, største først) på samme
  sted og med samme utseende. Heiskabinen i hangaren blir f.eks. fire stolper, to rekkverk, tak, gulv og lampe.
- **Behold filas origo ved import** (Innstillinger → Import, og `keep_origin` i MCP `import_model`): modellens origo havner
  i scenens origo i stedet for at modellen sentreres der kameraet ser. Deler som hører sammen, som hangaren og interiøret
  fra Nova Homestead, passer da sammen uten justering.

### Fixed
- Mappenavn trenger bare være unike blant søsken, som i et filtre. To nattbord kan nå begge ha undermappa «Skuffer», og
  et Python-skript som kjøres på nytt gjenbruker slike mapper i stedet for å lage «Skuffer 2», «Skuffer 3» …

## [0.9.0] — 2026-10-23

### Added
- **Markør-noder** (Flere → Node): usynlige, navngitte punkter med retning som spillmotoren leser fra modellen –
  dokkepunkter, hardpoints, motorer, spawn-punkter o.l. (navnene fra Unity-sidens oppskrifter, f.eks. `hp_turret_S_01`,
  `dock_entry`). Lokal +Z er forover og +Y opp, som i Unity etter import. Egne egenskaper (tall eller tekst) redigeres
  i egenskapspanelet, som Custom Properties i Blender. Kopier får neste nummer, speiling snur retningen riktig, og panelet
  varsler om like navn, mellomrom og `.001`. Markøren holder en minste størrelse på skjermen.
- **GLB-eksporten** tar med nodene som tomme noder med egenskapene som `extras`. Unity-siden leser dem med glTFast.
- **Import av noder**: tomme noder (Empties) i FBX- og GLB-filer blir markør-noder, med Custom Properties fra FBX
  og `extras` fra GLB som egenskaper. Nodene i hangaren fra Nova Homestead kommer f.eks. med `ship_class`, `max_length` osv.
- Claude og Python-skript kan lage noder (`add_objects` med `type: "node"` og `props`, `luna.node(..., props={...})`);
  `get_scene` viser nodenes retning (`forward`/`up`) i verdensrommet.
- **Fri flyging i scenen** som i Unity: hold høyre musknapp for å se deg rundt og fly med W/A/S/D, Q/E (ned/opp) og
  Shift (fortere); hjulet endrer farten. Panorering er flyttet til midtknappen. Kameraets nær-/fjernplan følger avstanden,
  så også stasjoner på flere kilometer vises.

### Fixed
- FBX-import bruker enheten fila oppgir (`UnitScaleFactor`) i stedet for å gjette ut fra størrelsen. Store modeller i
  meter (f.eks. hangaren på 800 m med innflyging) ble krympet ×0,01.
- FBX snus 180° om Y ved import, så en GLB eksportert fra Luna havner likt med FBX-en i Unity (Unity leser FBX som
  Blender (x, y, z) → (x, z, y), mens glTFast speiler X).
- MCP-broen kommer seg av seg selv når porten er opptatt (f.eks. av en gammel Claude-økt): serveren prøver å lytte
  på nytt hvert 3. sekund i stedet for å gi opp til Claude Code kobler den til på nytt.

## [0.8.0] — 2026-10-23

### Added
- **Kommentar-pinner**: sett en nummerert pinne med kommentar på et objekt eller bakken (pinneknappen eller N),
  f.eks. «her må noe gjøres». Pinner følger objektet de sitter på, har svartråd, kan markeres som løst, og listes
  under fanen «Kommentarer» (klikk flytter kameraet dit). Claude kan lese, svare på og løse pinner, og sette egne
  med konstruktive tilbakemeldinger (MCP `get_notes`, `add_note`, `reply_to_note`, `delete_notes`). Pinnene vises
  nummerert i Claudes skjermbilder og lagres i scenefila.

## [0.7.0] — 2026-10-23

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
