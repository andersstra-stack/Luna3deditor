# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versjonering: [Semantic Versioning](https://semver.org/).

Endringer skrives under [Unreleased] ved hver meningsfull commit. Ny versjon: `npm run bump -- minor`
(eller `patch`/`major`), så commit og `git tag vX.Y.Z`.

---

## [Unreleased]

### Added
- Import finner teksturene til en FBX i `<navn>.fbm`-mappa ved siden av (der Blender, Tripo o.l. legger dem), ikke bare
  i samme mappe som modellen.

## [0.15.0] — 2026-10-26

### Added
- **Tekstur på importerte modeller**: modeller med fotografisk tekstur (AI-genererte fra Tripo o.l., skannede modeller)
  vises nå med bildet sitt i stedet for én farge per trekant – paneler, lys og merker som er malt inn i teksturen kommer
  med. Teksturen lagres i scenefila, følger med ved kopier/lim inn og gjennom hull, og eksporteres i GLB-en som et eget
  materiale ved siden av paletten (også inne i «Én modell»). Fargen på objektet farger teksturen (hvit = som i fila).
  Lowpoly-modeller med fargepalett-bilder deles fortsatt opp i én del per farge. Teksturerte modeller kan ikke slås
  sammen eller deles opp ennå.

## [0.14.2] — 2026-10-26

### Changed
- Ny versjon vises som en linje rett under tittellinja («Luna 3D vX.Y.Z er klar» + notatet, «Oppdater nå» og kryss
  for «ikke nå») i stedet for en liten knapp i statuslinja. Appen ser også etter oppdateringer hver halvtime mens den
  står åpen, ikke bare ved oppstart.

## [0.14.1] — 2026-10-26

### Fixed
- Modeller med fotografisk tekstur (AI-genererte fra f.eks. Tripo, skannede modeller) ble nesten svarte ved import:
  bare de 24 vanligste eksakte fargene ble beholdt, og det er de mørke, minst støyete. Fargene grupperes nå
  (k-means, vektet med antall trekanter), så lyse paneler, blått og andre farger kommer med.

## [0.14.0] — 2026-10-26

### Added
- **Automatisk oppdatering**: ved oppstart sjekker appen lunaeco.no etter en nyere, signert versjon. Finnes en, vises
  «Oppdater til vX.Y.Z» i statuslinja – klikk spør om ulagrede endringer, laster ned, installerer og starter på nytt.
  Publiseres med `scripts/publish-release.sh`.
- **Overflate-treff** (MCP `raycast`): stråler inn i scenen gir treffpunkt, glatt flatenormal og hvilket objekt de
  traff – slik det vises, med hull og animasjon. Mange stråler i ett kall. Gjør at Claude kan plassere ting *på*
  overflater (epler på løvet, lamper i taket, fugler på greiner) i stedet for å regne blindt.
- **Fritt kamera for skjermbilder**: `screenshot` kan ramme inn bestemte objekter eller mapper (`focus`, `zoom`) eller
  ta bildet fra en valgt posisjon mot et punkt (`camera`). Brukerens kamera settes tilbake etterpå. `set_view` kan
  også fokusere på objekter.
- **Tegneserie-visning** (knapp i verktøypanelet, tasten T, Innstillinger → 3D-visning): flate lystrinn og mørke
  konturlinjer, så modellene ser tegnet ut mens du jobber. Bare visning og skjermbilder – GLB-eksporten endres ikke.

### Fixed
- Tall i scenefila og i svarene til Claude får ikke lenger avrundingsstøy (`0.951`, ikke `0.9510000000000001`).

## [0.13.0] — 2026-10-26

### Added
- **Animasjon** for bevegelige deler (dører, hjul, vindmøller, tårn, greiner):
  - Navngitte klipp («Åpne», «Snurr» …) med nøkkelrammer på objekter eller mapper. Nøkkelrammene er endringer fra
    hvileposisjonen rundt målets pivot – et objekt dreier om midtpunktet sitt, en mappe om en markør-node som heter
    `pivot` (hengsel, aksel) – så animasjonen følger med når ting flyttes.
  - Ferdige bevegelser i egenskapspanelet: snurr, svai, hopp og åpne/lukke (med akse, mengde og varighet).
  - Tidslinje nederst i 3D-visningen: velg klipp, spill av/pause (mellomrom), dra i tiden, sløyfe og slett.
  - GLB-eksporten tar med klippene som glTF-animasjoner (Unity/glTFast leser dem som klipp). Deler som er bakt inn i
    en ytre modell gir en advarsel.
  - MCP: `animate`, `set_keyframes`, `get_animations`, `delete_animations` og `preview_animation`; Python:
    `luna.animate` og `luna.keyframes`. Klippene lagres i scenefila og kan angres.
  - **Opptak med gizmoen**: med et klipp valgt står gizmoen på det som vises (mappas pivot, f.eks. hengselet), og å
    flytte, rotere eller skalere setter en nøkkelramme på tidspunktet i stedet for å endre selve modellen
    («Hvileposisjon» for det). Rotasjoner legges nærmest forrige verdi, så en dør over 90° ikke velter.
  - Nøkkelrammene i tidslinja kan dras til et nytt tidspunkt (0,05 s-trinn, Shift = 0,01 s), og dobbeltklikk sletter.
  - Markør-noder og lys følger med i avspillingen.
- **Egne former fra hjørner og trekanter** (MCP `add_objects` med `type: "mesh"`, Python `luna.mesh`): blader, steiner,
  kapper – alt som ikke er en grunnform. Hjørnene er i formens eget koordinatsystem, med valgfri farge per hjørne og
  myk eller flat skyggelegging. Like former lagres bare én gang, så hundrevis av like blader koster nesten ingenting.
- **Trekantteller** øverst til høyre: antall trekanter i det som eksporteres (synlige faste former, ikke hull, lys
  eller noder), og hvor mange av dem som er valgt. Følger detaljnivået (glatt/lavpoly).
- `luna.orient(forward, up)` i Python: rotasjonen som peker en form langs en retning (samme akser som nodene).
- Eksempeltreet (`tegneserietre.py`) har fått ekte blader: krona er bare blader (1 046 på 48 trekanter hver) i tre lag –
  lyst ytterst, mørkt innerst for dybde – med egen fargetone per løvklump, i stedet for glatte kuler.

### Changed
- Store skriptkjøringer svarer Claude med antall i stedet for alle id-ene (sparer mye når hundrevis av objekter lages).

## [0.12.0] — 2026-10-26

### Added
- **Kurverør** (Legg til → Flere former, MCP/Python `curve`): et rør langs en jevn kurve gjennom punkter, med én radius
  per punkt så det kan smalne av – greiner, røtter, kabler, håndtak. Punktene oppgis i verdensrommet (`points`), og
  `get_scene` gir dem tilbake på samme måte. Egenskapspanelet endrer tykkelsen og beholder avsmalningen. Rørene kan
  speiles, kopieres, få hull og eksporteres som alle andre former.
- **Avsmalnende sylinder** (`taper` 0–1, glidebryter i egenskapspanelet): toppen blir smalere enn bunnen – trestammer,
  bordben, vaser. 0 gir en spiss.
- Eksempelskriptet `scripting/eksempler/tegneserietre.py` bruker begge.
- **Mappe som én modell ved eksport** (pakke-knappen i scenelista, MCP/Python `model`): alt i mappa blir én mesh med
  ett palett-materiale per utseende i GLB-en – klart for Unity/Unreal – mens delene fortsatt kan redigeres hver for seg
  i Luna. Undermapper som også er modeller blir egne barn-mesher (dører, hjul, greiner som skal animeres), og en
  markør-node som heter `pivot` bestemmer origo (hengsel, aksel). Uten pivot står origo midt under modellen.
- **Ulagrede endringer vises**: en prikk ved scenenavnet i tittellinja og `*` foran navnet i oppgavelinja. Angrer du
  tilbake til lagret tilstand, forsvinner markøren.
- **Advarsel før endringer går tapt**: lukke vinduet, «Ny scene» og «Åpne» spør «Lagre / Ikke lagre / Avbryt» når
  scenen har ulagrede endringer.
- **Lagre som…** (Ctrl+Shift+S og egen knapp i verktøylinja).

### Changed
- **«Slå sammen» beholder fargene**: hver del får fargen sin per hjørne i stedet for at alt blir hovedvalgets farge.
  Fargene følger med gjennom hull og GLB-eksport, og «Del opp i løse deler» gir bitene fargen sin tilbake.

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
