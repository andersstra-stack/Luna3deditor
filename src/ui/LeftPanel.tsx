// Venstre panel med faner: scenelista og kommentar-pinnene.

import { useState } from "react";
import { useEditor } from "../store";
import { Outliner } from "./Outliner";
import { NotesPanel } from "./NotesPanel";

export function LeftPanel() {
  const [tab, setTab] = useState<"scene" | "notes">("scene");
  const openCount = useEditor((s) => s.notes.filter((n) => n.status === "open").length);
  // Når en pinne åpnes (f.eks. fra 3D-visningen) mens man er på scenefanen, beholdes fanen.
  return (
    <aside className="panel left-panel">
      <div className="panel-tabs">
        <button className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>
          Scene
        </button>
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>
          Kommentarer
          {openCount > 0 && <span className="tab-count">{openCount}</span>}
        </button>
      </div>
      {tab === "scene" ? <Outliner /> : <NotesPanel />}
    </aside>
  );
}
