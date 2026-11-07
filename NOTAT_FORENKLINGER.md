# Notat: enklere veier å fikse etterpå

Ting jeg la merke til mens figurene ble forenklet, rigget og animert (november 2026). Ikke gjort ennå – tatt med så vi kan
velge hva som er verdt det.

## Figurer og rigg

1. **Én knapp / ett verktøy for hele figuren.** Å rigge en Tripo-pilot er nå fem steg: importere, skalere til riktig høyde,
   lage menneskeskjelett, binde og importere animasjoner. Et samlet «Rigg figur» (MCP `rig_character { path, height,
   animations: [...] }` og en knapp) ville gjort det i ett.
2. **Høyde ved import.** Tripo-modellene kommer 1 m høye. `import_model` kunne tatt `height: 1.8` i stedet for at man regner ut
   og setter `scale` etterpå.
3. **Mappe med animasjoner.** `import_animation` tar én fil om gangen. Å gi en mappe (`L:/Assets/Animasjoner/Mixamo`) eller en
   liste ville spart mange kall.
4. **Store scenefiler.** Importerte klipp lagres som vanlige nøkkelrammer: Idle (16,6 s × 30 bilder × 22 bein) er 11 000 nøkler,
   og hver pilot-scene ble ca. 5 MB. Nøkkelreduksjon (fjerne rammer som ligger på en rett linje) eller å lagre klippet kompakt
   ville krympet det mye. Samme klipp på fem figurer lagres også fem ganger.
5. **Fingre.** Menneskeskjelettet har ikke fingerbein (Mixamo har det). Hender som griper eller peker blir stive.
6. **Python kan ikke importere animasjoner.** `luna.import_animation(...)` mangler fordi fila leses asynkront i appen. Kan løses
   ved at skript-op-en leser fila før endringene brukes.
7. **Én skin per modell.** Figurer av flere deler (som fiskeren) får ett skin per del i GLB-en. Ett felles skin per skjelett er
   ryddigere i Unity.
8. **Ingen manuell vektmaling.** Automatiske vekter strekker armhulen når armen løftes over ~90°. En enkel vektpensel eller
   «glatt vekter her» ville løst de verste tilfellene.

## Testing og verktøy

9. **Fast testklient.** Jeg brukte et midlertidig skript for å kalle MCP-verktøyene fra skallet (testhub, batch, bilder til fil).
   Det kunne ligge fast i `mcp-server/` (f.eks. `call.mjs`), sammen med et `npm run e2e` som starter testhub + `tauri dev`
   og kjører en kort ende-til-ende-sjekk.
10. **Testhubens logg.** Testhuben skriver også til `~/.luna3d/hub.log`, blandet med den ekte huben. En egen loggsti (miljøvariabel)
    ville holdt dem fra hverandre.
11. **Launch-oppsettet `tauri-test`** ligger i `.claude/launch.json`, som ikke er sporet i git. CLAUDE.md viser til det.
