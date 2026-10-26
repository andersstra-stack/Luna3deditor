import { useEditor } from "../store";
import type { TransformMode } from "../types";
import { frameScene } from "../viewport/three-handle";
import { Icon } from "./icons";

const MODES: { mode: TransformMode; label: string; key: string; icon: "move" | "rotate" | "scale" }[] = [
  { mode: "translate", label: "Flytt", key: "W", icon: "move" },
  { mode: "rotate", label: "Roter", key: "E", icon: "rotate" },
  { mode: "scale", label: "Skaler", key: "R", icon: "scale" },
];

/** Flytende verktøypanel oppe til venstre i 3D-visningen: gizmo-modus, festing, pinne og «vis alt». */
export function ViewportTools() {
  const transformMode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const objectSnap = useEditor((s) => s.objectSnap);
  const tool = useEditor((s) => s.tool);
  const { setTool, setTransformMode, toggleSnap, toggleObjectSnap } = useEditor.getState();

  return (
    <div className="viewport-tools">
      {MODES.map((m) => (
        <button
          key={m.mode}
          className={`icon-btn ${transformMode === m.mode ? "active" : ""}`}
          title={`${m.label} (${m.key})`}
          onClick={() => setTransformMode(m.mode)}
        >
          <Icon name={m.icon} />
        </button>
      ))}
      <div className="tool-sep" />
      <button className={`icon-btn ${snap ? "active" : ""}`} title="Fest til rutenett (X)" onClick={toggleSnap}>
        <Icon name="magnet" />
      </button>
      <button
        className={`icon-btn ${objectSnap ? "active" : ""}`}
        title="Fest til andre objekter – flater legger seg inntil hverandre (C)"
        onClick={toggleObjectSnap}
      >
        <Icon name="snapObject" />
      </button>
      <div className="tool-sep" />
      <button
        className={`icon-btn ${tool === "note" ? "active" : ""}`}
        title="Kommentar-pinne: klikk på et objekt for å si «her må noe gjøres» (N)"
        onClick={() => setTool(tool === "note" ? "select" : "note")}
      >
        <Icon name="pin" />
      </button>
      <button className="icon-btn" title="Vis hele scenen (F)" onClick={() => frameScene("current")}>
        <Icon name="frame" />
      </button>
    </div>
  );
}
