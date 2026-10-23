import { useEffect } from "react";
import "./App.css";
import { useEditor } from "./store";
import { saveScene, openScene } from "./io";
import { useMcpBridge } from "./bridge/useMcpBridge";
import { Viewport } from "./viewport/Viewport";
import { frameScene } from "./viewport/three-handle";
import { Toolbar } from "./ui/Toolbar";
import { Outliner } from "./ui/Outliner";
import { Inspector } from "./ui/Inspector";
import { StatusBar, reportError } from "./ui/StatusBar";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === "z" && !e.shiftKey) s.undo();
      else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) s.redo();
      else if (ctrl && key === "s") saveScene().catch(reportError);
      else if (ctrl && key === "o") openScene().catch(reportError);
      else if (ctrl && key === "d" && s.selectedId) s.duplicateObject(s.selectedId);
      else if (ctrl) return;
      else if (key === "w") s.setTransformMode("translate");
      else if (key === "e") s.setTransformMode("rotate");
      else if (key === "r") s.setTransformMode("scale");
      else if (key === "x") s.toggleSnap();
      else if (key === "f") frameScene("current");
      else if ((key === "delete" || key === "backspace") && s.selectedId) s.deleteObjects([s.selectedId]);
      else if (key === "escape") s.select(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  useMcpBridge();
  useShortcuts();
  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <Outliner />
        <div className="viewport">
          <Viewport />
        </div>
        <Inspector />
      </main>
      <StatusBar />
    </div>
  );
}
