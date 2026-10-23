// Egen tittelbar for det rammeløse vinduet (som LunaChat sin TitleBar): merke til venstre,
// scenens navn i midten og vindusknapper til høyre. Tomme flater med data-tauri-drag-region
// flytter vinduet, og dobbeltklikk maksimerer.

import { useEffect } from "react";
import { useEditor } from "../store";
import { WindowControls, setWindowTitle } from "./WindowControls";

export function TitleBar() {
  const filePath = useEditor((s) => s.filePath);
  const sceneTitle = filePath ? filePath.split(/[\\/]/).pop()! : "Ulagret scene";

  // Tittelen i oppgavelinja følger scenen.
  useEffect(() => setWindowTitle(`${sceneTitle} – Luna 3D`), [sceneTitle]);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="brand-moon" />
        <span>Luna 3D</span>
      </div>
      {/* Midtstilt og klikk-gjennomsiktig, så dra-området under virker også her. */}
      <span className="titlebar-scene">{sceneTitle}</span>
      <div className="titlebar-drag" data-tauri-drag-region />
      <WindowControls />
    </div>
  );
}
