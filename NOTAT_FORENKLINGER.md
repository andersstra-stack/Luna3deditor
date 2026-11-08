# Notat: enklere veier å fikse etterpå

Ting jeg la merke til mens figurene ble forenklet, rigget og animert (november 2026).

## Gjort (8. november 2026)

1. **Én knapp / ett verktøy for hele figuren** – MCP `rig_character { path, height, animations }` (import, skjelett, binding,
   animasjoner) og «Lag skjelett og bind» i egenskapspanelet.
2. **Høyde ved import** – `import_model` tar `height`.
3. **Mappe med animasjoner** – `import_animation` tar en mappe eller en liste, dialogen tar flere filer.
4. **Store scenefiler** – nøkkelreduksjon på importerte klipp (Idle: 11 000 → 828 nøkler).
6. **Python kan importere animasjoner** – `luna.import_animation(...)`, også en mappe.
7. **Én skin per skjelett** – alle bundne deler på samme skjelett blir én skinnet mesh i GLB-en.
9. **Fast testklient** – `npm run call` (`mcp-server/call.mjs`) og `npm run testhub`.
10. **Testhubens logg** – egen fil, `~/.luna3d/hub-47418.log`.

## Ikke gjort ennå

5. **Fingre.** Menneskeskjelettet har ikke fingerbein (Mixamo har det), så hender som griper eller peker blir stive. Tripo-hanskene
   er ofte smeltet sammen, så fingrene må finnes i mesh-en først. Ny funksjon, ikke en forenkling.
8. **Ingen manuell vektmaling.** Automatiske vekter strekker armhulen når armen løftes over ~90°. En enkel vektpensel eller
   «glatt vekter her» ville løst de verste tilfellene. Ny funksjon.
11. **Launch-oppsettet `tauri-test`** ligger i `.claude/launch.json`, som ikke er sporet i git (mappa har også personlige
    innstillinger). Kan legges i git hvis du vil, så det følger repoet.
12. **Samme klipp på flere figurer lagres flere ganger** (én gang per scene). Bare et problem hvis mange figurer ligger i samme
    scene.

## Egne animasjoner (fra konsoll-testen, 8. november 2026)

Testen «Konsoll» (piloten trykker, tenker, trykker videre) virket, men var stiv. Rekkefølge jeg ville tatt:

13. **Overgang som glir gjennom nøklene (spline).** I dag er hver overgang lineær eller «myk» (myk start og stopp), så en figur
    med mange nøkler bremser helt opp ved hver av dem. En kurve gjennom nøklene (Catmull-Rom) gir flytende bevegelse. Liten
    endring i `channelAt` (`animation.ts`) + eksporten sampler den uansett.
14. **Lag: Idle under egne bevegelser.** La et klipp ligge oppå et annet (f.eks. «Konsoll» oppå Mixamo-Idle), så pust,
    vektforskyvning og små bevegelser er med, og bare armene/hodet styres av det egne klippet. Utvidelse av klippsystemet.
15. **Liv i detaljene i skriptet:** hodet leder (ser før hånden går), albue og håndledd kommer litt etter skulderen,
    fingeren spretter litt opp etter trykket, vektforskyvning mellom føttene, pust i overkroppen.
16. **Gizmo-opptak med musa** på bein (velg klipp, drei beinet) er ikke prøvd ennå – bare matten bak er testet.
17. **IK i editoren.** Editoren kan ikke dra i hånden og la armen følge etter; konsoll-skriptet regner det ut selv
    (`N:\space ed characters\rigget\konsoll_test.py`). Et IK-håndtak i editoren ville gjort håndarbeid mye enklere.

## Animasjon fra video

18. **Prøv en nettjeneste først** (Rokoko Vision, DeepMotion, Plask): video → FBX som kan legges på pilotene med «Importer
    animasjon». Heter beina noe annet enn Mixamo-navnene, må navnene inn i `ALIASES` i `src/retarget.ts` (liten jobb).
19. **Video → animasjon i Luna selv:** en positurmodell (f.eks. MediaPipe) finner leddene i hvert bilde, og bevegelsen overføres
    til skjelettet med samme matte som `import_animation`. Krever glatting (skjelving, glidende føtter) og gir usikker dybde med
    ett kamera. Større jobb – vurder etter at punkt 18 er prøvd.
