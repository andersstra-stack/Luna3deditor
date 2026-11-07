import { useEffect, useRef, useState } from "react";
import { LIGHT_PRESETS, LIGHT_RANGES, PRESET_LABELS } from "../lighting";
import { useEditor } from "../store";
import { Icon } from "./icons";

const SLIDERS: { key: keyof typeof LIGHT_RANGES; label: string; step: number; unit?: string; title: string }[] = [
  { key: "sunAzimuth", label: "Retning", step: 1, unit: "°", title: "Hvor sola står rundt scenen: 0° forfra, 180° bakfra. Fyll- og kantlys følger med." },
  { key: "sunElevation", label: "Høyde", step: 1, unit: "°", title: "Solas høyde over horisonten" },
  { key: "sun", label: "Sol", step: 0.05, title: "Hovedlyset, det eneste som kaster skygger på bakken" },
  { key: "ambient", label: "Omgivelse", step: 0.05, title: "Jevnt lys fra himmel og bakke" },
  { key: "fill", label: "Fyll", step: 0.05, title: "Mykt lys som løfter skyggesiden" },
  { key: "rim", label: "Kant", step: 0.05, title: "Lys bakfra som tegner omrisset" },
  { key: "environment", label: "Miljø", step: 0.05, title: "Lys fra alle kanter, med refleksjoner i blanke flater" },
];

/** Knappen «Lys» i verktøylinja: ferdige oppsett og finjustering. Hører til scenen og lagres i scenefila. */
export function LightingMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lighting = useEditor((s) => s.lighting);
  // Første endring i et dra gir angre-steget; resten av draget går uten historikk.
  const dragging = useRef(false);

  // Lukk ved klikk utenfor, men ikke i 3D-visningen: der snur du kameraet for å se resultatet.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!rootRef.current?.contains(target) && !target.closest("canvas")) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const live = (change: Parameters<ReturnType<typeof useEditor.getState>["setLightingLive"]>[0]) => {
    const s = useEditor.getState();
    if (!dragging.current) {
      s.pushHistory();
      dragging.current = true;
    }
    s.setLightingLive(change);
  };
  const endDrag = () => {
    dragging.current = false;
  };

  return (
    <div className="more" ref={rootRef}>
      <button
        className={`add-btn view-btn ${open ? "active" : ""}`}
        title="Lyset i scenen: ferdige oppsett og finjustering. Lagres i scenefila; påvirker visning og ikoner, ikke eksporten."
        onClick={() => setOpen(!open)}
      >
        <Icon name="sun" />
        <span>Lys</span>
        <span className="add-caret">
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="more-menu lighting-menu">
          <div className="more-title">Oppsett</div>
          <div className="lighting-presets">
            {LIGHT_PRESETS.map((p) => (
              <button
                key={p}
                className={`lighting-preset ${lighting.preset === p ? "active" : ""}`}
                title={PRESET_LABELS[p].title}
                onClick={() => useEditor.getState().setLighting({ preset: p })}
              >
                {PRESET_LABELS[p].label}
              </button>
            ))}
          </div>
          <div className="more-title">Justering{lighting.preset === "custom" ? " (egendefinert)" : ""}</div>
          {SLIDERS.map(({ key, label, step, unit, title }) => (
            <label key={key} className="lighting-row" title={title}>
              <span>{label}</span>
              <input
                type="range"
                min={LIGHT_RANGES[key][0]}
                max={LIGHT_RANGES[key][1]}
                step={step}
                value={lighting[key]}
                onChange={(e) => live({ [key]: Number(e.target.value) })}
                onPointerUp={(e) => {
                  endDrag();
                  e.currentTarget.blur(); // ellers tar glidebryteren Ctrl+Z og de andre tastene
                }}
                onKeyUp={endDrag}
                onBlur={endDrag}
              />
              <span className="lighting-value">
                {lighting[key]}
                {unit ?? ""}
              </span>
            </label>
          ))}
          <label className="lighting-row" title="Fargen på sola">
            <span>Solfarge</span>
            <input
              type="color"
              value={lighting.sunColor}
              onChange={(e) => live({ sunColor: e.target.value })}
              onBlur={endDrag}
            />
          </label>
        </div>
      )}
    </div>
  );
}
