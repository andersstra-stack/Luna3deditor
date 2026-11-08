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
