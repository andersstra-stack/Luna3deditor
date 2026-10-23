// Kommentar-pinner i 3D-visningen: nummererte nåler (DOM over lerretet, så de alltid
// er lesbare) med et kort for tekst, svar, «løst» og sletting.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useEditor } from "../store";
import { anchorNote, isVisibleNote, noteWorldPosition } from "../notes";
import type { Note, SceneObject } from "../types";

const AUTHOR = { user: "Du", claude: "Claude" } as const;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Setter en ny pinne og åpner kortet for å skrive kommentaren. */
export function placeNote(point: THREE.Vector3, obj?: SceneObject) {
  const s = useEditor.getState();
  const note = s.addNote({ ...anchorNote(point, obj), text: "", author: "user" });
  s.openNote(note.id, true);
  s.setTool("select");
}

function NoteCard({ note }: { note: Note }) {
  const editing = useEditor((s) => s.editingNoteId === note.id);
  const { updateNote, replyToNote, deleteNotes, openNote } = useEditor.getState();
  const [draft, setDraft] = useState(note.text);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  // Vend kortet til venstre for nåla hvis det ellers stikker ut av 3D-visningen.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const area = card?.closest(".viewport")?.getBoundingClientRect();
    if (card && area && !flip && card.getBoundingClientRect().right > area.right - 8) setFlip(true);
  }, [flip]);
  // Fokus uten å scrolle: kortet kan stikke utenfor 3D-visningen, og vanlig autofocus
  // ville da dratt hele appen ut av stilling.
  useEffect(() => {
    if (editing) textRef.current?.focus({ preventScroll: true });
  }, [editing]);
  const [reply, setReply] = useState("");

  const save = () => {
    const text = draft.trim();
    if (!text) {
      // En ny pinne uten tekst forkastes; en eksisterende beholder teksten den hadde.
      if (!note.text) deleteNotes([note.id]);
      else openNote(note.id);
      return;
    }
    if (text !== note.text) updateNote(note.id, { text });
    openNote(note.id);
  };
  const cancel = () => (note.text ? openNote(note.id) : deleteNotes([note.id]));
  const sendReply = () => {
    if (!reply.trim()) return;
    replyToNote(note.id, { author: "user", text: reply.trim() });
    setReply("");
  };
  const submitOnCtrlEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) fn();
    if (e.key === "Escape") e.currentTarget === e.target && (editing ? cancel() : openNote(null));
  };

  return (
    <div ref={cardRef} className={`note-card ${flip ? "flip" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <span className={`note-badge ${note.author} ${note.status}`}>{note.number}</span>
        <span className="note-meta">
          {AUTHOR[note.author]} · {formatTime(note.createdAt)}
          {note.status === "done" && <b className="note-done"> · Løst</b>}
        </span>
        <button className="note-x" title="Lukk" onClick={() => openNote(null)}>
          ×
        </button>
      </header>

      {editing ? (
        <>
          <textarea
            ref={textRef}
            value={draft}
            placeholder="Hva må gjøres her?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={submitOnCtrlEnter(save)}
          />
          <div className="note-actions">
            <button className="note-primary" onClick={save}>
              Lagre
            </button>
            <button onClick={cancel}>Avbryt</button>
            <span className="note-hint">Ctrl+Enter</span>
          </div>
        </>
      ) : (
        <>
          <p className="note-text">{note.text}</p>
          {note.replies.map((r, i) => (
            <div key={i} className={`note-reply ${r.author}`}>
              <span className="note-meta">
                {AUTHOR[r.author]} · {formatTime(r.at)}
              </span>
              <p>{r.text}</p>
            </div>
          ))}
          <textarea
            className="note-reply-input"
            value={reply}
            placeholder="Svar…"
            rows={1}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={submitOnCtrlEnter(sendReply)}
          />
          <div className="note-actions">
            {reply.trim() && (
              <button className="note-primary" onClick={sendReply}>
                Svar
              </button>
            )}
            <button onClick={() => updateNote(note.id, { status: note.status === "open" ? "done" : "open" })}>
              {note.status === "open" ? "✓ Løst" : "Gjenåpne"}
            </button>
            {note.author === "user" && <button onClick={() => openNote(note.id, true)}>Rediger</button>}
            <button className="note-danger" onClick={() => deleteNotes([note.id])}>
              Slett
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function NotePins() {
  const notes = useEditor((s) => s.notes);
  const objects = useEditor((s) => s.objects);
  const show = useEditor((s) => s.showNotes);
  const showResolved = useEditor((s) => s.showResolvedNotes);
  const activeId = useEditor((s) => s.activeNoteId);

  const visible = useMemo(
    () => (show ? notes.filter((n) => n.id === activeId || isVisibleNote(n, showResolved)) : []),
    [notes, show, showResolved, activeId],
  );

  return (
    <>
      {visible.map((note) => (
        <Html key={note.id} position={noteWorldPosition(note, objects)} zIndexRange={[20, 10]}>
          <div className={`note-pin-wrap ${note.id === activeId ? "active" : ""}`}>
            <button
              className={`note-pin ${note.author} ${note.status}`}
              title={note.text}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useEditor.getState().openNote(note.id === activeId ? null : note.id)}
            >
              <span>{note.status === "done" ? "✓" : note.number}</span>
            </button>
            {note.id === activeId && <NoteCard note={note} />}
          </div>
        </Html>
      ))}
    </>
  );
}

/** Usynlig bakke som fanger klikk når pinneverktøyet er aktivt (pinne på bakken). */
export function NoteGroundCatcher() {
  const tool = useEditor((s) => s.tool);
  if (tool !== "note") return null;
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      visible={false}
      onClick={(e) => {
        e.stopPropagation();
        placeNote(e.point.clone());
      }}
    >
      <planeGeometry args={[400, 400]} />
    </mesh>
  );
}
