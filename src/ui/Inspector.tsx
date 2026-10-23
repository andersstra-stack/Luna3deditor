import { useEffect, useMemo, useRef, useState } from "react";
import { primaryId, useEditor } from "../store";
import { folderPath } from "../folders";
import { SHAPE_LABELS, isHelper, isLight, isNode, type NodeProps, type SceneObject, type Vec3 } from "../types";
import { AXES, type Axis } from "../bounds";
import { alignObjects, dropToGround, mirrorObjects, type AlignMode } from "../placement";
import { nodeAxes, nodeNameProblem } from "../nodes";
import { splitLooseParts } from "../meshSplit";
import { mergeObjects } from "../meshMerge";
import { reportError } from "./StatusBar";
import { Icon } from "./icons";

const AXIS_LABELS = ["X", "Y", "Z"] as const;

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
        {AXIS_LABELS.map((a, i) => (
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

type SliderField = "metalness" | "roughness" | "opacity" | "intensity";

/** Glidebryter som gjelder alle valgte objekter (verdien vises fra hovedvalget). */
function Slider({
  title,
  objs,
  field,
  max = 1,
  percent = true,
}: {
  title: string;
  objs: SceneObject[];
  field: SliderField;
  max?: number;
  percent?: boolean;
}) {
  const { updateObjectsLive, pushHistory } = useEditor.getState();
  const value = objs[objs.length - 1][field] ?? 0;
  return (
    <div className="row">
      <div className="row-title">
        {title}
        <span className="value">{percent ? `${Math.round(value * 100)}%` : Math.round(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={max / 100}
        value={value}
        onPointerDown={pushHistory}
        onChange={(e) => updateObjectsLive(objs.map((o) => ({ id: o.id, [field]: Number(e.target.value) })))}
      />
    </div>
  );
}

function FolderSelect({ objs }: { objs: SceneObject[] }) {
  const folders = useEditor((s) => s.folders);
  const options = useMemo(
    () => folders.map((f) => ({ id: f.id, path: folderPath(folders, f.id) })).sort((a, b) => a.path.localeCompare(b.path, "nb")),
    [folders],
  );
  const same = objs.every((o) => o.folderId === objs[0].folderId);
  return (
    <div className="row">
      <div className="row-title">Mappe</div>
      <select
        className="text"
        value={same ? (objs[0].folderId ?? "") : "__mixed"}
        onChange={(e) => useEditor.getState().moveToFolder({ objectIds: objs.map((o) => o.id) }, e.target.value || null)}
      >
        {!same && (
          <option value="__mixed" disabled>
            (flere mapper)
          </option>
        )}
        <option value="">— Ingen (scene-roten) —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.path}
          </option>
        ))}
      </select>
    </div>
  );
}

function ColorRow({ objs }: { objs: SceneObject[] }) {
  const { updateObjects, updateObjectsLive, pushHistory } = useEditor.getState();
  const color = objs[objs.length - 1].color;
  return (
    <div className="row">
      <div className="row-title">Farge</div>
      <div className="color-row">
        <input
          type="color"
          value={color}
          onPointerDown={pushHistory}
          onChange={(e) => updateObjectsLive(objs.map((o) => ({ id: o.id, color: e.target.value })))}
        />
        <input
          key={color}
          className="text"
          defaultValue={color}
          onBlur={(e) => {
            const c = e.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(c) && c !== color) updateObjects(objs.map((o) => ({ id: o.id, color: c })));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
    </div>
  );
}

/** Viser at objektene kommer fra et Python-skript (og erstattes når det kjøres igjen). */
function ScriptSource({ objs }: { objs: SceneObject[] }) {
  const tagged = objs.filter((o) => o.script);
  if (!tagged.length) return null;
  const scripts = [...new Set(tagged.map((o) => o.script!.split("/").pop()))];
  return (
    <div className="script-source" title="Kjøres skriptet igjen, erstattes disse objektene med det nye resultatet">
      <Icon name="code" size={14} />
      <span>
        Fra skript <b>{scripts.join(", ")}</b>
        <small>Erstattes når skriptet kjøres igjen</small>
      </span>
      <button
        className="small-btn"
        title="Behold objektet selv om skriptet kjøres igjen"
        onClick={() => useEditor.getState().updateObjects(tagged.map((o) => ({ id: o.id, script: undefined })))}
      >
        Løsne
      </button>
    </div>
  );
}

function HoleToggle({ objs }: { objs: SceneObject[] }) {
  const solids = objs.filter((o) => !isHelper(o.type));
  if (!solids.length) return null;
  const on = solids.every((o) => o.hole);
  return (
    <label className={`toggle-row ${on ? "on" : ""}`} title="Hull skjærer seg inn i de andre objektene i samme mappe">
      <input
        type="checkbox"
        checked={on}
        onChange={() => useEditor.getState().updateObjects(solids.map((o) => ({ id: o.id, hole: !on })))}
      />
      <Icon name="hole" size={16} />
      <span>
        Hull
        <small>Skjærer bort fra andre objekter i samme mappe</small>
      </span>
    </label>
  );
}

/** Tekst fra et felt → verdi: tall blir tall, resten tekst (Unity leser bare tall og tekst). */
function parsePropValue(text: string): string | number {
  const t = text.trim().replace(",", ".");
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : text;
}

const PROP_KIND = { string: "tekst", number: "tall" } as const;

/** Egendefinerte egenskaper på en node (Custom Properties i Blender, `extras` i GLB). */
function NodePropsEditor({ obj }: { obj: SceneObject }) {
  const props = obj.props ?? {};
  const entries = Object.entries(props);
  const save = (next: NodeProps) => useEditor.getState().updateObject(obj.id, { props: next });

  const rename = (from: string, to: string) => {
    const key = to.trim();
    if (key === from) return;
    // Tomt navn fjerner egenskapen; et navn som finnes fra før lar vi være.
    if (key && key in props) return reportError(new Error(`Egenskapen «${key}» finnes allerede`));
    save(Object.fromEntries(entries.flatMap(([k, v]) => (k === from ? (key ? [[key, v]] : []) : [[k, v]]))));
  };
  const add = () => {
    let key = "egenskap";
    for (let i = 2; key in props; i++) key = `egenskap_${i}`;
    save({ ...props, [key]: "" });
  };

  return (
    <div className="row">
      <div className="row-title">
        Egenskaper <span className="value">eksporteres som extras</span>
      </div>
      {entries.map(([key, value]) => (
        <div className="node-prop" key={obj.id + key}>
          <input
            className="text"
            defaultValue={key}
            placeholder="navn"
            onBlur={(e) => rename(key, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <input
            key={String(value)}
            className="text"
            defaultValue={String(value)}
            placeholder="verdi"
            onBlur={(e) => {
              const v = parsePropValue(e.target.value);
              if (v !== value) save({ ...props, [key]: v });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span className="kind">{PROP_KIND[typeof value as keyof typeof PROP_KIND]}</span>
          <button className="icon-btn" title="Fjern egenskapen" onClick={() => rename(key, "")}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className="btn-row">
        <button className="small-btn" title="Tall eller tekst, f.eks. type = pirate_grunt, yaw_min = -150, loop = 1" onClick={add}>
          + Legg til egenskap
        </button>
      </div>
    </div>
  );
}

function NodeInfo({ obj }: { obj: SceneObject }) {
  const objects = useEditor((s) => s.objects);
  const problem = nodeNameProblem(obj, objects);
  const { forward, up } = nodeAxes(obj);
  const fmt = (v: Vec3) => v.map((c) => Number(c.toFixed(2))).join(", ");
  return (
    <>
      {problem && <p className="node-warning">{problem}</p>}
      <p className="node-axes">
        Forover (lokal +Z): <b>{fmt(forward)}</b>
        <br />
        Opp (lokal +Y): <b>{fmt(up)}</b>
      </p>
    </>
  );
}

const run = (fn: () => unknown) => () => {
  try {
    fn();
  } catch (e) {
    reportError(e);
  }
};

const ALIGN_MODES: [AlignMode, string][] = [
  ["min", "Min"],
  ["center", "Midt"],
  ["max", "Maks"],
];

function Placement({ objs }: { objs: SceneObject[] }) {
  const ids = objs.map((o) => o.id);
  return (
    <>
      <div className="section-title">Plassering</div>
      <div className="btn-row">
        <button
          className="small-btn"
          title="Senk til det hviler på objektet under, eller bakken (End)"
          onClick={run(() => dropToGround(ids))}
        >
          <Icon name="ground" size={14} /> Legg ned på underlaget
        </button>
      </div>

      {objs.length > 1 && (
        <>
          <div className="row-title">Innrett etter «{objs[objs.length - 1].name}»</div>
          {AXES.map((a: Axis) => (
            <div className="btn-row" key={a}>
              <span className={`label axis-${a}`}>{a.toUpperCase()}</span>
              {ALIGN_MODES.map(([m, label]) => (
                <button key={m} className="small-btn" onClick={run(() => alignObjects(ids, a, m))}>
                  {label}
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      <div className="btn-row">
        <span className="label">Speil</span>
        {AXES.map((a) => (
          <button
            key={a}
            className={`small-btn axis-${a}`}
            title={`Snu utvalget om ${a.toUpperCase()}-aksen`}
            onClick={run(() => mirrorObjects(ids, a, false))}
          >
            {a.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <span className="label">Speilkopi</span>
        {AXES.map((a) => (
          <button
            key={a}
            className={`small-btn axis-${a}`}
            title={`Lag en speilvendt kopi på andre siden av ${a.toUpperCase()} = 0`}
            onClick={run(() => mirrorObjects(ids, a, true))}
          >
            {a.toUpperCase()}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Modeller: del i bitene som ikke henger sammen (som «By Loose Parts» i Blender),
 * eller slå flere valgte deler sammen til én modell (som Ctrl+J).
 */
function ModelTools({ objs }: { objs: SceneObject[] }) {
  const meshes = objs.filter((o) => o.type === "mesh");
  const mergeable = objs.filter((o) => !isHelper(o.type) && !o.hole);
  if (!meshes.length && mergeable.length < 2) return null;
  return (
    <div className="btn-row">
      {meshes.length > 0 && (
        <button
          className="small-btn"
          title="Del modellen i bitene som ikke henger sammen – hver bit blir et eget objekt"
          onClick={run(() => splitLooseParts(meshes.map((o) => o.id)))}
        >
          <Icon name="shapes" size={14} /> Del opp i løse deler
        </button>
      )}
      {mergeable.length > 1 && (
        <button
          className="small-btn"
          title="Gjør de valgte delene til én modell. Den får fargen til hovedvalget (sist valgte)."
          onClick={run(() => mergeObjects(mergeable.map((o) => o.id)))}
        >
          <Icon name="copy" size={14} /> Slå sammen
        </button>
      )}
    </div>
  );
}

function Actions({ objs }: { objs: SceneObject[] }) {
  const { duplicateObjects, deleteObjects } = useEditor.getState();
  const ids = objs.map((o) => o.id);
  return (
    <div className="actions">
      <button onClick={() => duplicateObjects(ids)}>
        <Icon name="copy" size={14} /> Dupliser
      </button>
      <button className="danger" onClick={() => deleteObjects(ids)}>
        <Icon name="trash" size={14} /> Slett
      </button>
    </div>
  );
}

function Help() {
  return (
    <div className="help">
      <p>Klikk på et objekt for å velge det. Ctrl+klikk velger flere.</p>
      <h3>Kamera</h3>
      <dl>
        <dt>Venstre mus</dt>
        <dd>Roter</dd>
        <dt>Midtknapp</dt>
        <dd>Panorer</dd>
        <dt>Hjul</dt>
        <dd>Zoom</dd>
        <dt>Høyre mus + WASD</dt>
        <dd>Fly fritt (Q/E ned/opp, Shift fortere, hjul endrer farten)</dd>
        <dt>F</dt>
        <dd>Vis alt</dd>
      </dl>
      <h3>Snarveier</h3>
      <dl>
        <dt>W / E / R</dt>
        <dd>Flytt / roter / skaler</dd>
        <dt>C</dt>
        <dd>Fest til andre objekter</dd>
        <dt>X</dt>
        <dd>Fest til rutenett</dd>
        <dt>End</dt>
        <dd>Legg ned på underlaget</dd>
        <dt>Ctrl+A</dt>
        <dd>Velg alt</dd>
        <dt>Ctrl+C / X / V</dt>
        <dd>Kopier / klipp ut / lim inn</dd>
        <dt>Ctrl+D</dt>
        <dd>Dupliser</dd>
        <dt>Delete</dt>
        <dd>Slett</dd>
        <dt>Ctrl+Z / Y</dt>
        <dd>Angre / gjør om</dd>
        <dt>Ctrl+S</dt>
        <dd>Lagre</dd>
        <dt>Ctrl+I</dt>
        <dd>Importer 3D-modell</dd>
        <dt>N</dt>
        <dd>Kommentar-pinne</dd>
      </dl>
      <h3>Mapper</h3>
      <p>
        Lag mapper med mappe-knappen i scenelista, og dra objekter inn i dem. Klikk på en mappe for å velge alt i den – da flytter
        gizmoen hele mappa, og nye former havner i den.
      </p>
      <h3>Hull</h3>
      <p>
        Gjør et objekt til «hull» i egenskapene, så skjærer det seg inn i de andre objektene i samme mappe – f.eks. vinduer i en
        vegg.
      </p>
      <h3>Importere modeller</h3>
      <p>
        FBX, GLB/glTF, OBJ og STL: importknappen, Ctrl+I eller dra fila inn i vinduet. Modeller med flere deler havner i en egen
        mappe. Store modeller (cm/mm) skaleres automatisk til meter. Farger fra teksturbilder hentes fra samme mappe – drar du filer inn, ta med bildet. Modellen deles i én del per farge.
      </p>
      <h3>Claude</h3>
      <p>Når Claude Code er koblet til (grønn prikk øverst), kan du be Claude om å bygge, endre og se på scenen.</p>
    </div>
  );
}

export function Inspector() {
  const objects = useEditor((s) => s.objects);
  const selectedIds = useEditor((s) => s.selectedIds);
  const pid = useEditor(primaryId);
  // Hovedvalget legges sist – det er det verdiene vises fra.
  const objs = useMemo(() => {
    const rest = objects.filter((o) => selectedIds.includes(o.id) && o.id !== pid);
    const primary = objects.find((o) => o.id === pid);
    return primary ? [...rest, primary] : rest;
  }, [objects, selectedIds, pid]);
  const obj = objs[objs.length - 1];
  const { updateObject } = useEditor.getState();

  if (!obj) {
    return (
      <aside className="panel inspector">
        <h2>Egenskaper</h2>
        <Help />
      </aside>
    );
  }

  if (objs.length > 1) {
    return (
      <aside className="panel inspector">
        <h2>Egenskaper</h2>
        <p className="multi-title">{objs.length} objekter valgt</p>
        <FolderSelect objs={objs} />
        <ScriptSource objs={objs} />
        <ColorRow objs={objs} />
        <HoleToggle objs={objs} />
        <Placement objs={objs} />
        <ModelTools objs={objs} />
        <Actions objs={objs} />
      </aside>
    );
  }

  const light = isLight(obj.type);
  const node = isNode(obj.type);
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
      {node && <NodeInfo obj={obj} />}

      <FolderSelect objs={objs} />
      <ScriptSource objs={objs} />

      <Vec3Row title="Posisjon (m)" obj={obj} field="position" step={0.01} />
      <Vec3Row title="Rotasjon (°)" obj={obj} field="rotation" step={0.5} />
      {!light && !node && <Vec3Row title="Størrelse (m)" obj={obj} field="scale" step={0.01} />}

      <ColorRow objs={objs} />

      {node ? (
        <NodePropsEditor obj={obj} />
      ) : light ? (
        <Slider title="Lysstyrke" objs={objs} field="intensity" max={200} percent={false} />
      ) : (
        <>
          <HoleToggle objs={objs} />
          <Slider title="Metallisk" objs={objs} field="metalness" />
          <Slider title="Ruhet" objs={objs} field="roughness" />
          <Slider title="Synlighet" objs={objs} field="opacity" />
        </>
      )}

      <Placement objs={objs} />
      <ModelTools objs={objs} />
      <Actions objs={objs} />
    </aside>
  );
}
