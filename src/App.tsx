import { useEffect } from "react";
import "./styles/theme.css";
import "./App.css";
import { useEditor } from "./store";
import { saveScene, openScene } from "./io";
import { useMcpBridge } from "./bridge/useMcpBridge";
import { Viewport } from "./viewport/Viewport";
import { frameScene } from "./viewport/three-handle";
import { dropToGround } from "./placement";
import { copySelection, pasteText } from "./clipboard";
import { IMPORT_EXTENSIONS, importDroppedFiles, importModelFile } from "./importer";
import { SelectionInfo } from "./ui/SelectionInfo";
import { Toolbar } from "./ui/Toolbar";
import { ViewportTools } from "./ui/ViewportTools";
import { TitleBar } from "./ui/TitleBar";
import { LeftPanel } from "./ui/LeftPanel";
import { Inspector } from "./ui/Inspector";
import { StatusBar, reportError } from "./ui/StatusBar";
import { SettingsDialog } from "./ui/SettingsDialog";
import { useUi } from "./ui/uiStore";

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

/** Slipp 3D-filer (FBX, GLB, OBJ, STL) hvor som helst i vinduet for å importere dem. */
function useFileDrop() {
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      try {
        // Bilder (fargepaletter/teksturer) og .mtl som slippes sammen med modellen brukes til farger.
        const { imported, skipped } = await importDroppedFiles(Array.from(e.dataTransfer!.files));
        if (skipped.length) reportError(new Error(`Kan ikke importere ${skipped.join(", ")} – støttet: ${IMPORT_EXTENSIONS.join(", ")}`));
        else if (!imported.length) reportError(new Error("Ingen 3D-modell blant filene"));
      } catch (err) {
        reportError(err);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      // Innstillingsdialogen håndterer sine egne taster (Escape lukker den).
      if (useUi.getState().settingsOpen) return;
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      const sel = s.selectedIds;

      if (ctrl && key === "z" && !e.shiftKey) s.undo();
      else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) s.redo();
      else if (ctrl && key === "s") saveScene().catch(reportError);
      else if (ctrl && key === "o") openScene().catch(reportError);
      else if (ctrl && key === "i") importModelFile().catch(reportError);
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
      else if (key === "n") s.setTool(s.tool === "note" ? "select" : "note");
      else if (key === "escape") {
        if (s.tool === "note") s.setTool("select");
        else if (s.activeNoteId) s.openNote(null);
        else s.select(null);
      }
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
  useFileDrop();
  return (
    <div className="app">
      <div className="app-orb app-orb-1" />
      <div className="app-orb app-orb-2" />
      <TitleBar />
      <Toolbar />
      <main className="workspace">
        <LeftPanel />
        <div className="viewport">
          <Viewport />
          <ViewportTools />
          <SelectionInfo />
        </div>
        <Inspector />
      </main>
      <StatusBar />
      <SettingsDialog />
    </div>
  );
}
