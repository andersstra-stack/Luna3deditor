# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versjonering: [Semantic Versioning](https://semver.org/).

Endringer skrives under [Unreleased] ved hver meningsfull commit. Ny versjon: `npm run bump -- minor`
(eller `patch`/`major`), så commit og `git tag vX.Y.Z`.

---

## [Unreleased]

## [0.21.0] — 2026-11-08

### Added
- **Menneskeskjelett med ett klikk**: «Lag menneskeskjelett» i egenskapspanelet (MCP `add_humanoid_skeleton`, Python
  `luna.humanoid`) plasserer 22 bein med Mixamo-navn (Hips, Spine … LeftArm, LeftForeArm …) ut fra en figur i T- eller
  A-positur – armene langs armens midtlinje, beina symmetrisk, høydene etter Mixamo-proporsjoner. Unity kan kjenne igjen
  skjelettet som Humanoid.
- **Mixamo-animasjoner på egne figurer**: «Importer animasjon (Mixamo FBX)…» i animasjonspanelet (MCP `import_animation`)
  legger en FBX- eller GLB-animasjon på beina med samme navn. En Mixamo-rigg i T-positur passer på en figur i A-positur, og
  hoftenes bevegelse skaleres til figurens høyde. Animasjonen blir et vanlig klipp som vises i editoren og eksporteres i
  GLB-en. Valg av en bundet modell viser klippene som beveger den. Prøvd på fem Tripo-piloter med Idle, Walking, Running,
  Waving, Talking og Sitting.

- **Rigg en figur i ett steg**: MCP-verktøyet `rig_character` tar en modellfil og en mappe med Mixamo-animasjoner og gjør
  resten – import i riktig høyde (standard 1,8 m) i en egen mappe, menneskeskjelett, binding og alle animasjonene. En pilot
  med 17 Mixamo-klipp tok under 6 sekunder. I egenskapspanelet lager «Lag skjelett og bind» skjelettet og binder i samme klikk.
- `import_model` tar `height` (meter), så en figur som kommer 1 m høy fra Tripo kan importeres i riktig størrelse.
- `import_animation` tar flere filer eller en hel mappe, og dialogen i animasjonspanelet lar deg velge flere filer.
  `luna.import_animation(...)` gjør det samme fra Python (også en mappe).

### Changed
- **Mindre scenefiler med animasjoner**: importerte klipp lagrer bare nøklene som trengs (en nøkkel som ligger på linja mellom
  naboene innen 0,3° og 1 mm, fjernes). Mixamo-Idle gikk fra 11 000 til 828 nøkler, og en pilot med 17 klipp tar 4,1 MB.
- **Én skin per figur i GLB-en**: alle delene som er bundet til samme skjelett, eksporteres som én skinnet mesh med ett
  materiale per utseende – én SkinnedMeshRenderer i Unity i stedet for én per del. Fiskeren gikk fra 12 skins til 1.

### Fixed
- Lagring av scenen lager mappa hvis den mangler (som GLB-eksporten allerede gjorde).

## [0.20.0] — 2026-11-07

### Added
- **Forenkle modeller**: «Forenkle» i egenskapspanelet (ved «Del opp» og «Slå sammen») gir modeller færre trekanter –
  velg hvor mange prosent som skal bli igjen. Panelet viser antall trekanter i utvalget. UV-er, hjørnefarger, tekstur og
  normalkart beholdes, og sømmer og harde kanter holdes på plass. Objektet beholder plass, størrelse, pinner og
  animasjoner, og alt kan angres i ett steg. Fiskerens hode gikk fra 158 379 til 15 837 trekanter på under ett sekund
  uten synlig forskjell. Claude kan gjøre det samme med det nye MCP-verktøyet `simplify_mesh` og `luna.simplify` i Python.
- **Skjelett og rigg for figurer**: «Legg til → Bein» lager bein som henger i hverandre (med et bein valgt fortsetter det nye
  fra tuppen). Beina vises gjennom modellen, kan flyttes og speiles (speilkopi bytter _L/_R i navnet og beholder hierarkiet),
  og panelet har forelderbein og «Nytt bein fra tuppen». «Bind til skjelett» gir modellene automatiske hudvekter – bein som
  ligger utenfor en modell (låret ved siden av hånden) får ikke dra i den. Etterpå animeres beina i de vanlige klippene, og
  modellene bøyer seg med. GLB-eksporten skriver skjelettet som glTF skin med vekter og animasjonene på beina, så figuren
  kan spilles av i Unity. Claude kan bygge det samme med `add_objects` (type `bone` med `head`, `tail` og `parent`), det
  nye verktøyet `skin_mesh` og `luna.bone`/`luna.skin` i Python. En forenklet modell som er bundet, får nye vekter automatisk.
- **Ruhetskart på egne former**: `roughness_map` (gråtoner: svart = blankt, hvitt = matt, ganget med ruheten) fra Python og
  MCP, ved siden av tekstur og normalkart. Det vises i 3D-visningen, lagres i scenen og blir glTF
  `metallicRoughnessTexture` i eksporten – våte lepper, slitt lær og blank hud uten flere trekanter.

### Changed
- **Mye raskere skriving av GLB og ikoner**: bytene sendes rett til fila i stedet for som en lang liste med tall. Fiskeren
  (GLB på 60 MB) ble ikke ferdig på fem minutter i utviklingsbygget og tettet igjen vinduet; nå tar hele eksporten 2,3
  sekunder. Hodet alene (23 MB) gikk fra 10,3 til 0,5 sekunder å skrive.

## [0.19.0] — 2026-11-07

### Added
- **Referansebilder**: legg inn et foto eller en tegning å modellere etter, med «Legg til → Bilde…» eller ved å dra PNG/JPEG
  inn i vinduet. Bildet vender mot kameraet, er halvgjennomsiktig og beholder fargene sine uansett lys. Det lagres i scenen,
  men kommer ikke med i GLB-eksport eller ikoner, og snapping og hull ser bort fra det. Claude kan legge inn det samme fra
  Python (`luna.reference`) og MCP (`type: "reference"`), og ser det på skjermbilder.

## [0.18.0] — 2026-11-07

### Added
- **Lysoppsett**: ny «Lys»-knapp i verktøylinja med ferdige oppsett (Standard, Studio, Overskyet, Kveld) og glidebrytere
  for solas retning, høyde, styrke og farge, omgivelseslys, fyll-, kant- og miljølys. Studio-oppsettet viser formen fra
  alle kanter, så baksiden ikke lenger blir svart, og miljølyset gir refleksjoner i blanke flater. Lyset lagres per scene
  og kan angres. Det gjelder visningen, skjermbilder og ikoner, ikke eksporten. Standard ser ut som før, så eksisterende
  scener og ikoner beholder lyset sitt. Claude kan styre det samme med det nye MCP-verktøyet `set_lighting`.
- **Teksturer og normalkart på egne former**: `type: "mesh"` tar nå `uvs`, `texture`, `normal_map` og `normal_scale` fra
  Python og MCP. Et normalkart gir finne detaljer som porer og strikk uten flere trekanter, også sammen med hjørnefarger.
  Bildene lagres i scenefila, følger med ved kopiering mellom vinduer og skrives inn i GLB-en. Samme bilde deles mellom
  objekter og sendes bare én gang.

### Fixed
- **`tauri dev` ved siden av installert app**: utviklingsvinduer kobler seg til huben med egen etikett. Før hadde begge et
  vindu som het «main», og da sparket de hverandre ut av Claude-tilkoblingen i en løkke.
- **Tidsavbrudd på tunge scener**: lagring, åpning, import, GLB-eksport og Python-skript via MCP får nå 5 minutter i stedet
  for 20 sekunder. Før kunne Claude få beskjed om tidsavbrudd selv om fila ble skrevet.

## [0.17.0] — 2026-11-02

### Added
- **Ikoner (`render_icon`)**: nytt MCP-verktøy som lager et kvadratisk ikon av objekter eller mapper, for eksempel til
  inventaret eller byggemenyen i spillet. Bakgrunnen er gjennomsiktig, modellen rammes tett inn med et ortografisk
  kamera (skrått forfra som standard), og bare de valgte formene tegnes: ikke rutenett, skyggeplan, noder,
  lys-markører eller resten av scenen. Lyset og fargene er som i visningen. Ikonet lagres som PNG, og brukerens kamera
  røres ikke.

### Changed
- **Eksport lager mappen**: GLB-eksport og ikoner lager mappen de skal skrives til, hvis den mangler.
- **Tegneserie-knapp i verktøylinja**: av/på for tegneserie-visningen ligger nå som en egen knapp med tekst øverst
  ved siden av angre/gjør om, i stedet for et lite ikon i verktøypanelet i 3D-visningen. Tasten T virker som før.

## [0.16.1] — 2026-10-28

### Fixed
- **Hull skjærer også egne former**: hull ble ikke skåret i egne og importerte former (`type: "mesh"`) når en vanlig
  form med UV-er (f.eks. en boks) var skåret først i vinduet. Da ble formen vist og eksportert uten hull.
  three-bvh-csg 0.0.18 tar med seg attributtene fra forrige kutt, så nå har hvert sett med attributter sin egen
  evaluator.
- **Glød i modeller eksporteres alltid**: i en mappe som eksporteres som én modell ble glødkartet (`_emission.png`) bare
  koblet på materialet hvis den første delen i materialgruppa glødet. Nå holder det at én av delene gløder.
- **Mindre flimring i 3D-visningen**: kameraets nær-plan følger nå avstanden tettere (avstand/250 i stedet for
  /2000), så dybdebufferen skiller flater som ligger noen millimeter fra hverandre – maling, merker og skilt på
  modeller – også når man ser en hel stasjon eller et skip på avstand.

## [0.16.0] — 2026-10-27

### Added
- **Flere prosjekter samtidig**: «Nytt vindu» (Ctrl+Shift+N) åpner et eget prosjektvindu med sin egen scene,
  angrehistorikk og 3D-visning. Flere Claude-økter kan jobbe samtidig, hver i sitt vindu, uten å vente på hverandre:
  MCP-serveren er nå en felles hub (`~/.luna3d/hub.log` viser hvilken økt som gjorde hva) som Claude-øktene kobler seg
  til. Nye verktøy `list_projects`, `use_project` og `open_project` (åpner en scenefil i nytt vindu). Er bare ett vindu
  åpent, brukes det automatisk. Claude-pillen viser hvor mange økter som jobber i vinduet.

### Fixed
- Skjermbilder fra Claude virker også når vinduet er minimert eller dekket av andre vinduer (ventet før på at
  vinduet tegnet seg selv, og ga tidsavbrudd).

## [0.15.1] — 2026-10-26

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
