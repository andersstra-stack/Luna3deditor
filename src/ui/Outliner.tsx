import { useState } from "react";
import { useEditor } from "../store";
import { Icon, ShapeIcon } from "./icons";

export function Outliner() {
  const objects = useEditor((s) => s.objects);
  const selectedId = useEditor((s) => s.selectedId);
  const { select, updateObject, deleteObjects } = useEditor.getState();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <aside className="panel outliner">
      <h2>Scene</h2>
      {objects.length === 0 && (
        <p className="empty">
          Tom scene. Legg til en form fra verktøylinja – eller be Claude om å bygge noe.
        </p>
      )}
      <ul>
        {objects.map((o) => (
          <li
            key={o.id}
            className={`${o.id === selectedId ? "selected" : ""} ${o.visible ? "" : "hidden-obj"}`}
            onClick={() => select(o.id)}
            onDoubleClick={() => setEditing(o.id)}
          >
            <span className="swatch" style={{ color: o.color }}>
              <ShapeIcon type={o.type} size={15} />
            </span>
            {editing === o.id ? (
              <input
                autoFocus
                defaultValue={o.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== o.name) updateObject(o.id, { name });
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <span className="name">{o.name}</span>
            )}
            <button
              className="row-btn"
              title={o.visible ? "Skjul" : "Vis"}
              onClick={(e) => {
                e.stopPropagation();
                updateObject(o.id, { visible: !o.visible });
              }}
            >
              <Icon name={o.visible ? "eye" : "eyeOff"} size={14} />
            </button>
            <button
              className="row-btn danger"
              title="Slett"
              onClick={(e) => {
                e.stopPropagation();
                deleteObjects([o.id]);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
