// Liste over kommentar-pinner i venstre panel. Klikk flytter kameraet til pinnen og åpner den.

import { useEditor } from "../store";
import { isVisibleNote, noteWorldPosition } from "../notes";
import { focusPoint } from "../viewport/three-handle";
import { Icon } from "./icons";

export function NotesPanel() {
  const notes = useEditor((s) => s.notes);
  const objects = useEditor((s) => s.objects);
  const activeId = useEditor((s) => s.activeNoteId);
  const showNotes = useEditor((s) => s.showNotes);
  const showResolved = useEditor((s) => s.showResolvedNotes);
  const tool = useEditor((s) => s.tool);
  const { openNote, setShowNotes, setShowResolvedNotes, setTool } = useEditor.getState();

  const list = notes.filter((n) => isVisibleNote(n, showResolved)).sort((a, b) => b.number - a.number);
  const resolved = notes.filter((n) => n.status === "done").length;

  return (
    <div className="notes-panel">
      <div className="notes-tools">
        <button className={`small-btn ${tool === "note" ? "active" : ""}`} onClick={() => setTool(tool === "note" ? "select" : "note")}>
          <Icon name="pin" size={14} /> {tool === "note" ? "Klikk i scenen…" : "Ny pinne (N)"}
        </button>
        <button className="icon-btn small" title={showNotes ? "Skjul pinner i 3D" : "Vis pinner i 3D"} onClick={() => setShowNotes(!showNotes)}>
          <Icon name={showNotes ? "eye" : "eyeOff"} size={15} />
        </button>
      </div>

      {notes.length === 0 && (
        <p className="empty">
          Ingen kommentarer ennå. Velg pinneverktøyet og klikk på et objekt for å si «her må noe gjøres» – Claude kan lese,
          svare og løse dem.
        </p>
      )}

      <ul className="notes-list">
        {list.map((n) => {
          const obj = n.objectId ? objects.find((o) => o.id === n.objectId) : undefined;
          return (
            <li
              key={n.id}
              className={`${n.id === activeId ? "selected" : ""} ${n.status}`}
              onClick={() => {
                setShowNotes(true);
                focusPoint(noteWorldPosition(n, objects));
                openNote(n.id);
              }}
            >
              <span className={`note-badge ${n.author} ${n.status}`}>{n.status === "done" ? "✓" : n.number}</span>
              <span className="note-summary">
                <span className="note-line">{n.text || "(uten tekst)"}</span>
                <small>
                  {n.author === "claude" ? "Claude" : "Du"}
                  {obj ? ` · ${obj.name}` : ""}
                  {n.replies.length ? ` · ${n.replies.length} svar` : ""}
                </small>
              </span>
            </li>
          );
        })}
      </ul>

      {resolved > 0 && (
        <button className="link-plain" onClick={() => setShowResolvedNotes(!showResolved)}>
          {showResolved ? "Skjul løste" : `Vis ${resolved} løst${resolved === 1 ? "" : "e"}`}
        </button>
      )}
    </div>
  );
}
