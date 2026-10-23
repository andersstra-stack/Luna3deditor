import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { SHAPE_LABELS, type SceneObject, type Vec3 } from "../types";
import { Icon } from "./icons";

const AXES = ["X", "Y", "Z"] as const;

/**
 * Tallfelt som kan skrives i, eller "skrubbes" ved å dra i aksebokstaven.
 * Endringer lagres i historikken først når du slipper / trykker Enter.
 */
function NumberField({
  label,
  value,
  step,
  onLive,
  onCommit,
  onDragStart,
}: {
  label: string;
  value: number;
  step: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  onDragStart: () => void;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(Number(value.toFixed(3))));
  }, [value]);

  const commitText = () => {
    const v = Number(text.replace(",", "."));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(Number(value.toFixed(3))));
  };

  const startScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) onDragStart();
      moved = true;
      const factor = ev.shiftKey ? 0.1 : 1;
      onLive(Number((start + dx * step * factor).toFixed(3)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <label className={`num axis-${label.toLowerCase()}`}>
      <span className="axis" onPointerDown={startScrub} title="Dra for å endre (Shift = finjuster)">
        {label}
      </span>
      <input
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function Vec3Row({ title, obj, field, step }: { title: string; obj: SceneObject; field: "position" | "rotation" | "scale"; step: number }) {
  const { updateObject, updateObjectLive, pushHistory } = useEditor.getState();
  const withAxis = (i: number, v: number) => obj[field].map((c, j) => (j === i ? v : c)) as Vec3;
  return (
    <div className="row">
      <div className="row-title">{title}</div>
      <div className="vec3">
        {AXES.map((a, i) => (
          <NumberField
            key={a}
            label={a}
            value={obj[field][i]}
            step={step}
            onDragStart={pushHistory}
            onLive={(v) => updateObjectLive(obj.id, { [field]: withAxis(i, v) })}
            onCommit={(v) => updateObject(obj.id, { [field]: withAxis(i, v) })}
          />
        ))}
      </div>
    </div>
  );
}

function Slider({ title, obj, field }: { title: string; obj: SceneObject; field: "metalness" | "roughness" | "opacity" }) {
  const { updateObjectLive, pushHistory } = useEditor.getState();
  return (
    <div className="row">
      <div className="row-title">
        {title}
        <span className="value">{Math.round(obj[field] * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={obj[field]}
        onPointerDown={pushHistory}
        onChange={(e) => updateObjectLive(obj.id, { [field]: Number(e.target.value) })}
      />
    </div>
  );
}

export function Inspector() {
  const obj = useEditor((s) => s.objects.find((o) => o.id === s.selectedId));
  const { updateObject, updateObjectLive, pushHistory, duplicateObject, deleteObjects } = useEditor.getState();

  if (!obj) {
    return (
      <aside className="panel inspector">
        <h2>Egenskaper</h2>
        <div className="help">
          <p>Klikk på et objekt for å velge det.</p>
          <h3>Kamera</h3>
          <dl>
            <dt>Venstre mus</dt>
            <dd>Roter</dd>
            <dt>Høyre mus</dt>
            <dd>Panorer</dd>
            <dt>Hjul</dt>
            <dd>Zoom</dd>
            <dt>F</dt>
            <dd>Vis alt</dd>
          </dl>
          <h3>Snarveier</h3>
          <dl>
            <dt>W / E / R</dt>
            <dd>Flytt / roter / skaler</dd>
            <dt>X</dt>
            <dd>Fest til rutenett</dd>
            <dt>Ctrl+D</dt>
            <dd>Dupliser</dd>
            <dt>Delete</dt>
            <dd>Slett</dd>
            <dt>Ctrl+Z / Y</dt>
            <dd>Angre / gjør om</dd>
            <dt>Ctrl+S</dt>
            <dd>Lagre</dd>
          </dl>
          <h3>Claude</h3>
          <p>
            Når Claude Code er koblet til (grønn prikk øverst), kan du be Claude om å bygge, endre og se på scenen.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel inspector">
      <h2>Egenskaper</h2>
      <div className="row">
        <div className="row-title">
          Navn <span className="value">{SHAPE_LABELS[obj.type]}</span>
        </div>
        <input
          key={obj.id + obj.name}
          className="text"
          defaultValue={obj.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== obj.name) updateObject(obj.id, { name });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>

      <Vec3Row title="Posisjon (m)" obj={obj} field="position" step={0.01} />
      <Vec3Row title="Rotasjon (°)" obj={obj} field="rotation" step={0.5} />
      <Vec3Row title="Størrelse (m)" obj={obj} field="scale" step={0.01} />

      <div className="row">
        <div className="row-title">Farge</div>
        <div className="color-row">
          <input
            type="color"
            value={obj.color}
            onPointerDown={pushHistory}
            onChange={(e) => updateObjectLive(obj.id, { color: e.target.value })}
          />
          <input
            key={obj.color}
            className="text"
            defaultValue={obj.color}
            onBlur={(e) => {
              const c = e.target.value.trim();
              if (/^#[0-9a-f]{6}$/i.test(c) && c !== obj.color) updateObject(obj.id, { color: c });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>

      <Slider title="Metallisk" obj={obj} field="metalness" />
      <Slider title="Ruhet" obj={obj} field="roughness" />
      <Slider title="Synlighet" obj={obj} field="opacity" />

      <div className="actions">
        <button onClick={() => duplicateObject(obj.id)}>
          <Icon name="copy" size={14} /> Dupliser
        </button>
        <button className="danger" onClick={() => deleteObjects([obj.id])}>
          <Icon name="trash" size={14} /> Slett
        </button>
      </div>
    </aside>
  );
}
