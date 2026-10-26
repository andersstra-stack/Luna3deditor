import { useEditor, type BridgeStatus } from "../store";
import { useEffect, useRef, useState } from "react";
import {
  BASIC_SHAPES,
  DEFAULT_SCALE,
  EXTRA_SHAPES,
  LIGHTS,
  MARKERS,
  SHAPE_LABELS,
  startHeight,
  type ShapeType,
} from "../types";
import { exportGlb, newScene, openScene, saveScene, saveSceneAs, type GlbExport } from "../io";
import { importModelFile } from "../importer";
import { runPythonScriptFile } from "../scripting";
import { useUi } from "./uiStore";
import { viewTargetOnGround } from "../viewport/three-handle";
import { Icon, ShapeIcon } from "./icons";
import { reportError } from "./StatusBar";
import { PolyCounter } from "./PolyCounter";

const BRIDGE_TEXT: Record<BridgeStatus, { label: string; title: string }> = {
  connected: { label: "Claude tilkoblet", title: "Claude Code er koblet til via MCP og kan endre scenen" },
  disconnected: { label: "Claude ikke tilkoblet", title: "Venter på Claude Code (MCP-serveren startes av Claude Code)" },
  busy: { label: "Claude i annet vindu", title: "Et annet Luna 3D-vindu er allerede koblet til Claude" },
};

function reportExport(r: GlbExport | null) {
  if (!r) return;
  const file = (path: string) => path.split(/[\\/]/).pop();
  useEditor
    .getState()
    .setActivity(
      `Eksporterte ${file(r.path)}: ${r.colors} farger i ${file(r.palette)}${r.emission ? ` + ${file(r.emission)}` : ""}` +
        (r.models ? `, ${r.models} modell${r.models === 1 ? "" : "er"}` : "") +
        (r.nodes ? `, ${r.nodes} noder` : ""),
    );
}

export function Toolbar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const bridge = useEditor((s) => s.bridgeStatus);
  const { addObject, undo, redo } = useEditor.getState();

  // Lukk «Legg til»-menyen ved klikk utenfor.
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
    const y = startHeight(type, DEFAULT_SCALE[type] ?? [1, 1, 1]);
    addObject(type, { position: [x, y, z], folderId: useEditor.getState().activeFolderId });
    setMoreOpen(false);
  };

  const shapeButton = (t: ShapeType) => (
    <button key={t} className="shape-btn" title={`Legg til ${SHAPE_LABELS[t].toLowerCase()}`} onClick={() => add(t)}>
      <ShapeIcon type={t} />
      <span>{SHAPE_LABELS[t]}</span>
    </button>
  );

  return (
    <header className="toolbar">
      <div className="tool-group">
        <button className="icon-btn" title="Ny scene" onClick={() => newScene().catch(reportError)}>
          <Icon name="file" />
        </button>
        <button className="icon-btn" title="Åpne… (Ctrl+O)" onClick={() => openScene().catch(reportError)}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="Lagre (Ctrl+S)" onClick={() => saveScene().catch(reportError)}>
          <Icon name="save" />
        </button>
        <button className="icon-btn" title="Lagre som… (Ctrl+Shift+S)" onClick={() => saveSceneAs().catch(reportError)}>
          <Icon name="saveAs" />
        </button>
        <button
          className="icon-btn"
          title="Importer 3D-modell – FBX, GLB/glTF, OBJ, STL (Ctrl+I). Du kan også dra filer inn i vinduet."
          onClick={() => importModelFile().catch(reportError)}
        >
          <Icon name="import" />
        </button>
        <button
          className="icon-btn"
          title="Kjør Python-skript (.py) som bygger eller endrer scenen – se scripting/eksempler"
          onClick={() => runPythonScriptFile().catch(reportError)}
        >
          <Icon name="code" />
        </button>
        <button className="icon-btn" title="Eksporter GLB (til Blender, Roblox, Unity…)" onClick={() => exportGlb().then(reportExport).catch(reportError)}>
          <Icon name="export" />
        </button>
      </div>

      <div className="more" ref={moreRef}>
        <button
          className={`add-btn ${moreOpen ? "active" : ""}`}
          title="Legg til en form, et lys eller en markør"
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Icon name="shapes" />
          <span>Legg til</span>
          <span className="add-caret">
            <Icon name="chevron" size={12} />
          </span>
        </button>
        {moreOpen && (
          <div className="more-menu">
            <div className="more-title">Grunnformer</div>
            <div className="more-grid">{BASIC_SHAPES.map(shapeButton)}</div>
            <div className="more-title">Flere former</div>
            <div className="more-grid">{EXTRA_SHAPES.map(shapeButton)}</div>
            <div className="more-title">Lys</div>
            <div className="more-grid">{LIGHTS.map(shapeButton)}</div>
            <div className="more-title">Markører</div>
            <div className="more-grid">{MARKERS.map(shapeButton)}</div>
          </div>
        )}
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

      <PolyCounter />

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
