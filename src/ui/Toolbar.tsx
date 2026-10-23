import { useEditor, type BridgeStatus } from "../store";
import { useEffect, useRef, useState } from "react";
import {
  BASIC_SHAPES,
  DEFAULT_SCALE,
  EXTRA_SHAPES,
  LIGHTS,
  SHAPE_LABELS,
  isLight,
  type ShapeType,
  type TransformMode,
} from "../types";
import { exportGlb, openScene, saveScene } from "../io";
import { importModelFile } from "../importer";
import { useUi } from "./uiStore";
import { frameScene, viewTargetOnGround } from "../viewport/three-handle";
import { Icon, ShapeIcon } from "./icons";
import { reportError } from "./StatusBar";

const MODES: { mode: TransformMode; label: string; key: string; icon: "move" | "rotate" | "scale" }[] = [
  { mode: "translate", label: "Flytt", key: "W", icon: "move" },
  { mode: "rotate", label: "Roter", key: "E", icon: "rotate" },
  { mode: "scale", label: "Skaler", key: "R", icon: "scale" },
];

const BRIDGE_TEXT: Record<BridgeStatus, { label: string; title: string }> = {
  connected: { label: "Claude tilkoblet", title: "Claude Code er koblet til via MCP og kan endre scenen" },
  disconnected: { label: "Claude ikke tilkoblet", title: "Venter på Claude Code (MCP-serveren startes av Claude Code)" },
  busy: { label: "Claude i annet vindu", title: "Et annet Luna 3D-vindu er allerede koblet til Claude" },
};

export function Toolbar() {
  const transformMode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const objectSnap = useEditor((s) => s.objectSnap);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const bridge = useEditor((s) => s.bridgeStatus);
  const { addObject, setTransformMode, toggleSnap, toggleObjectSnap, undo, redo, clearScene, setFilePath } = useEditor.getState();

  // Lukk "Flere former" ved klikk utenfor.
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  const add = (type: ShapeType) => {
    const [x, z] = viewTargetOnGround();
    const y = isLight(type) ? 2.5 : type === "plane" ? 0 : (DEFAULT_SCALE[type]?.[1] ?? 1) / 2;
    addObject(type, { position: [x, y, z], folderId: useEditor.getState().activeFolderId });
    setMoreOpen(false);
  };

  const shapeButton = (t: ShapeType) => (
    <button key={t} className="shape-btn" title={`Legg til ${SHAPE_LABELS[t].toLowerCase()}`} onClick={() => add(t)}>
      <ShapeIcon type={t} />
      <span>{SHAPE_LABELS[t]}</span>
    </button>
  );

  const newScene = () => {
    if (useEditor.getState().objects.length && !confirm("Starte en ny, tom scene?")) return;
    clearScene();
    setFilePath(null);
  };

  return (
    <header className="toolbar">
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
        <button
          className="icon-btn"
          title="Importer 3D-modell – FBX, GLB/glTF, OBJ, STL (Ctrl+I). Du kan også dra filer inn i vinduet."
          onClick={() => importModelFile().catch(reportError)}
        >
          <Icon name="import" />
        </button>
        <button className="icon-btn" title="Eksporter GLB (til Blender, Roblox, Unity…)" onClick={() => exportGlb().catch(reportError)}>
          <Icon name="export" />
        </button>
      </div>

      <div className="tool-group shapes">
        {BASIC_SHAPES.map(shapeButton)}
        <div className="more" ref={moreRef}>
          <button className={`shape-btn ${moreOpen ? "active" : ""}`} title="Flere former og lys" onClick={() => setMoreOpen(!moreOpen)}>
            <Icon name="shapes" size={18} />
            <span>Flere</span>
          </button>
          {moreOpen && (
            <div className="more-menu">
              <div className="more-title">Former</div>
              <div className="more-grid">{EXTRA_SHAPES.map(shapeButton)}</div>
              <div className="more-title">Lys</div>
              <div className="more-grid">{LIGHTS.map(shapeButton)}</div>
            </div>
          )}
        </div>
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
        <button
          className={`icon-btn ${objectSnap ? "active" : ""}`}
          title="Fest til andre objekter – flater legger seg inntil hverandre (C)"
          onClick={toggleObjectSnap}
        >
          <Icon name="snapObject" />
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

      <button className="icon-btn" title="Innstillinger – tema og versjon" onClick={() => useUi.getState().openSettings()}>
        <Icon name="settings" />
      </button>

      <div className={`claude-pill ${bridge}`} title={BRIDGE_TEXT[bridge].title}>
        <span className="dot" />
        {BRIDGE_TEXT[bridge].label}
      </div>
    </header>
  );
}
