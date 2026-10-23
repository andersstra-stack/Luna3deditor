import { useEffect } from "react";
import "./App.css";
import { useEditor } from "./store";
import { saveScene, openScene } from "./io";
import { useMcpBridge } from "./bridge/useMcpBridge";
import { Viewport } from "./viewport/Viewport";
import { frameScene } from "./viewport/three-handle";
import { dropToGround } from "./placement";
import { copySelection, pasteText } from "./clipboard";
import { SelectionInfo } from "./ui/SelectionInfo";
import { Toolbar } from "./ui/Toolbar";
import { Outliner } from "./ui/Outliner";
import { Inspector } from "./ui/Inspector";
import { StatusBar, reportError } from "./ui/StatusBar";

/** Ctrl+C / Ctrl+X / Ctrl+V for objekter. Tekstfelt beholder vanlig kopier/lim inn. */
function useClipboard() {
  useEffect(() => {
    const inTextField = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select");
    const onCopyOrCut = (e: ClipboardEvent) => {
      if (inTextField(e) || window.getSelection()?.toString()) return;
      const text = copySelection(e.type === "cut");
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inTextField(e)) return;
      const text = e.clipboardData?.getData("text/plain");
      if (text && pasteText(text)) e.preventDefault();
    };
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      const sel = s.selectedIds;

      if (ctrl && key === "z" && !e.shiftKey) s.undo();
      else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) s.redo();
      else if (ctrl && key === "s") saveScene().catch(reportError);
      else if (ctrl && key === "o") openScene().catch(reportError);
      else if (ctrl && key === "d" && sel.length) s.duplicateObjects(sel);
      else if (ctrl && key === "a") s.selectMany(s.objects.map((o) => o.id));
      else if (ctrl) return;
      else if (key === "w") s.setTransformMode("translate");
      else if (key === "e") s.setTransformMode("rotate");
      else if (key === "r") s.setTransformMode("scale");
      else if (key === "x") s.toggleSnap();
      else if (key === "c") s.toggleObjectSnap();
      else if (key === "f") frameScene("current");
      else if (key === "end" && sel.length) dropToGround(sel);
      else if ((key === "delete" || key === "backspace") && sel.length) s.deleteObjects(sel);
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
  useClipboard();
  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <Outliner />
        <div className="viewport">
          <Viewport />
          <SelectionInfo />
        </div>
        <Inspector />
      </main>
      <StatusBar />
    </div>
  );
}
