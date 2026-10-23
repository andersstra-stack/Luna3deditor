import { useEditor } from "../store";
import { SHAPES, SHAPE_LABELS, type ShapeType, type TransformMode } from "../types";
import { exportGlb, openScene, saveScene } from "../io";
import { frameScene, viewTargetOnGround } from "../viewport/three-handle";
import { Icon, ShapeIcon } from "./icons";
import { reportError } from "./StatusBar";

const MODES: { mode: TransformMode; label: string; key: string; icon: "move" | "rotate" | "scale" }[] = [
  { mode: "translate", label: "Flytt", key: "W", icon: "move" },
  { mode: "rotate", label: "Roter", key: "E", icon: "rotate" },
  { mode: "scale", label: "Skaler", key: "R", icon: "scale" },
];

export function Toolbar() {
  const transformMode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const bridge = useEditor((s) => s.bridgeStatus);
  const { addObject, setTransformMode, toggleSnap, undo, redo, clearScene, setFilePath } = useEditor.getState();

  const add = (type: ShapeType) => {
    const [x, z] = viewTargetOnGround();
    addObject(type, { position: [x, type === "plane" ? 0 : 0.5, z] });
  };

  const newScene = () => {
    if (useEditor.getState().objects.length && !confirm("Starte en ny, tom scene?")) return;
    clearScene();
    setFilePath(null);
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-moon" />
        Luna 3D
      </div>

      <div className="tool-group">
        <button className="icon-btn" title="Ny scene" onClick={newScene}>
          <Icon name="file" />
        </button>
        <button className="icon-btn" title="Åpne… (Ctrl+O)" onClick={() => openScene().catch(reportError)}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="Lagre (Ctrl+S)" onClick={() => saveScene().catch(reportError)}>
          <Icon name="save" />
        </button>
        <button className="icon-btn" title="Eksporter GLB (til Blender, Roblox, Unity…)" onClick={() => exportGlb().catch(reportError)}>
          <Icon name="export" />
        </button>
      </div>

      <div className="tool-group shapes">
        {SHAPES.map((t) => (
          <button key={t} className="shape-btn" title={`Legg til ${SHAPE_LABELS[t].toLowerCase()}`} onClick={() => add(t)}>
            <ShapeIcon type={t} />
            <span>{SHAPE_LABELS[t]}</span>
          </button>
        ))}
      </div>

      <div className="tool-group">
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
        <button className={`icon-btn ${snap ? "active" : ""}`} title="Fest til rutenett (X)" onClick={toggleSnap}>
          <Icon name="magnet" />
        </button>
        <button className="icon-btn" title="Vis hele scenen (F)" onClick={() => frameScene("current")}>
          <Icon name="frame" />
        </button>
      </div>

      <div className="tool-group">
        <button className="icon-btn" title="Angre (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="Gjør om (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
      </div>

      <div className="spacer" />

      <div
        className={`claude-pill ${bridge}`}
        title={
          bridge === "connected"
            ? "Claude Code er koblet til via MCP og kan endre scenen"
            : "Venter på Claude Code (MCP-serveren startes av Claude Code)"
        }
      >
        <span className="dot" />
        {bridge === "connected" ? "Claude tilkoblet" : "Claude ikke tilkoblet"}
      </div>
    </header>
  );
}
