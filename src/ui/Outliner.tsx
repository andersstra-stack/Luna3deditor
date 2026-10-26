import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { primaryId, useEditor } from "../store";
import { folderChain, folderPath, hiddenFolderIds, isInside } from "../folders";
import { Icon, ShapeIcon } from "./icons";
import { reportError } from "./StatusBar";

type DragItem = { kind: "object" | "folder"; id: string };
/** undefined = ingen, null = scene-roten */
type DropTarget = string | null | undefined;

const INDENT = 14;

function RenameInput({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  return (
    <input
      autoFocus
      defaultValue={value}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const name = e.target.value.trim();
        onDone(name && name !== value ? name : null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

export function Outliner() {
  const objects = useEditor((s) => s.objects);
  const folders = useEditor((s) => s.folders);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor(primaryId);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeFolderId = useEditor((s) => s.activeFolderId);
  const collapsed = useEditor((s) => s.collapsed);
  const {
    select,
    selectMany,
    selectFolder,
    updateObject,
    deleteObjects,
    addFolders,
    updateFolders,
    deleteFolders,
    moveToFolder,
    setCollapsed,
    setActiveFolder,
  } = useEditor.getState();

  const [editing, setEditing] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(undefined);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragItem | null>(null);

  const hidden = useMemo(() => hiddenFolderIds(folders), [folders]);
  // Antall objekter i hver mappe, inkludert undermapper.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of objects) for (const fid of folderChain(folders, o.folderId)) c[fid] = (c[fid] ?? 0) + 1;
    return c;
  }, [objects, folders]);

  // Når noe velges i 3D-visningen: åpne mappene det ligger i og rull det fram.
  useEffect(() => {
    const obj = objects.find((o) => o.id === selectedId);
    if (!obj) return;
    const s = useEditor.getState();
    for (const fid of folderChain(s.folders, obj.folderId)) if (s.collapsed[fid]) s.setCollapsed(fid, false);
    requestAnimationFrame(() => document.querySelector(`[data-row="${selectedId}"]`)?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const canDropInto = (target: string | null) => {
    const d = drag.current;
    if (!d) return false;
    return !(d.kind === "folder" && target && isInside(folders, target, d.id));
  };

  const dragProps = (item: DragItem) => ({
    draggable: editing !== item.id,
    onDragStart: (e: DragEvent) => {
      drag.current = item;
      setDragging(true);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
    },
    onDragEnd: () => {
      drag.current = null;
      setDragging(false);
      setDropTarget(undefined);
    },
  });

  const dropProps = (target: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!canDropInto(target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (dropTarget !== target) setDropTarget(target);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      setDropTarget(undefined);
      if (!d) return;
      try {
        const objectIds = selected.has(d.id) ? selectedIds : [d.id];
        moveToFolder(d.kind === "object" ? { objectIds } : { folderIds: [d.id] }, target);
        if (target) setCollapsed(target, false);
      } catch (err) {
        reportError(err);
      }
    },
  });

  const newFolder = () => {
    const [f] = addFolders([{ parentId: activeFolderId }]);
    if (activeFolderId) setCollapsed(activeFolderId, false);
    select(null);
    setActiveFolder(f.id);
    setEditing(f.id);
  };

  // Rekkefølgen objektradene vises i – brukes til Shift-klikk (område).
  const order: string[] = [];

  const clickObject = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) return select(id, "toggle");
    if (e.shiftKey && selectedId) {
      const a = order.indexOf(selectedId);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        // Behold hovedvalget sist.
        return selectMany([...range.filter((r) => r !== selectedId), selectedId]);
      }
    }
    select(id);
  };

  const renderLevel = (parentId: string | null, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (const f of folders.filter((f) => f.parentId === parentId)) {
      const isCollapsed = !!collapsed[f.id];
      const isHidden = hidden.has(f.id);
      rows.push(
        <li
          key={f.id}
          data-row={f.id}
          className={`folder-row ${activeFolderId === f.id ? "active" : ""} ${isHidden ? "hidden-obj" : ""} ${
            dropTarget === f.id ? "drop" : ""
          }`}
          style={{ paddingLeft: 4 + depth * INDENT }}
          onClick={() => selectFolder(f.id)}
          onDoubleClick={() => setEditing(f.id)}
          {...dragProps({ kind: "folder", id: f.id })}
          {...dropProps(f.id)}
        >
          <button
            className={`chevron ${isCollapsed ? "" : "open"}`}
            title={isCollapsed ? "Åpne" : "Lukk"}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(f.id, !isCollapsed);
            }}
          >
            <Icon name="chevron" size={12} />
          </button>
          <span className="swatch folder-icon">
            <Icon name={isCollapsed ? "folder" : "folderOpen"} size={15} />
          </span>
          {editing === f.id ? (
            <RenameInput
              value={f.name}
              onDone={(name) => {
                if (name) updateFolders([{ id: f.id, name }]);
                setEditing(null);
              }}
            />
          ) : (
            <span className="name">{f.name}</span>
          )}
          <span className="count">{counts[f.id] ?? 0}</span>
          <button
            className={`row-btn model-toggle ${f.model ? "on" : ""}`}
            title={
              f.model
                ? "Eksporteres som én modell (én mesh, ett palett-materiale). Klikk for å eksportere delene hver for seg."
                : "Eksporter mappa som én modell – for spillmotoren. En markør-node som heter «pivot» blir origo."
            }
            onClick={(e) => {
              e.stopPropagation();
              updateFolders([{ id: f.id, model: !f.model }]);
            }}
          >
            <Icon name="package" size={14} />
          </button>
          <button
            className="row-btn"
            title={f.visible ? "Skjul mappe" : "Vis mappe"}
            onClick={(e) => {
              e.stopPropagation();
              updateFolders([{ id: f.id, visible: !f.visible }]);
            }}
          >
            <Icon name={f.visible ? "eye" : "eyeOff"} size={14} />
          </button>
          <button
            className="row-btn danger"
            title="Slett mappe (innholdet flyttes ut)"
            onClick={(e) => {
              e.stopPropagation();
              deleteFolders([f.id]);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>,
      );
      if (!isCollapsed) rows.push(...renderLevel(f.id, depth + 1));
    }

    for (const o of objects.filter((o) => o.folderId === parentId)) {
      order.push(o.id);
      const isHidden = !o.visible || (o.folderId !== null && hidden.has(o.folderId));
      rows.push(
        <li
          key={o.id}
          data-row={o.id}
          className={`${selected.has(o.id) ? "selected" : ""} ${isHidden ? "hidden-obj" : ""}`}
          style={{ paddingLeft: 4 + depth * INDENT + 18 }}
          onClick={(e) => clickObject(o.id, e)}
          onDoubleClick={() => setEditing(o.id)}
          {...dragProps({ kind: "object", id: o.id })}
          {...dropProps(o.folderId)}
        >
          <span className="swatch" style={{ color: o.color }}>
            <ShapeIcon type={o.type} size={15} />
          </span>
          {editing === o.id ? (
            <RenameInput
              value={o.name}
              onDone={(name) => {
                if (name) updateObject(o.id, { name });
                setEditing(null);
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
        </li>,
      );
    }
    return rows;
  };

  const empty = objects.length === 0 && folders.length === 0;

  return (
    <div className="outliner">
      <div className="panel-header">
        <h2>Scene</h2>
        <button className="icon-btn small" title="Ny mappe" onClick={newFolder}>
          <Icon name="folderPlus" size={16} />
        </button>
      </div>

      {activeFolderId && (
        <div className="active-folder">
          <span>
            Nye objekter havner i <b>{folderPath(folders, activeFolderId)}</b>
          </span>
          <button title="Legg i scene-roten i stedet" onClick={() => setActiveFolder(null)}>
            ×
          </button>
        </div>
      )}

      {empty && (
        <p className="empty">Tom scene. Legg til en form fra verktøylinja – eller be Claude om å bygge noe.</p>
      )}

      <ul
        className={`tree ${dropTarget === null ? "drop" : ""}`}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          select(null);
          setActiveFolder(null);
        }}
        {...dropProps(null)}
      >
        {renderLevel(null, 0)}
        {dragging && <li className="root-drop">Slipp her for å flytte ut av mappene</li>}
      </ul>
    </div>
  );
}
