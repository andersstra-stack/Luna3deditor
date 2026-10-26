// «Animasjon» i egenskapspanelet: ferdige bevegelser på det valgte objektet eller den valgte mappa.

import { useState } from "react";
import { useEditor } from "../store";
import { isInside } from "../folders";
import { PRESETS, PRESET_DEFAULTS, PRESET_LABELS, type Axis, type Preset } from "../animation";
import { usePlayer } from "../animationPlayer";
import type { SceneObject } from "../types";
import { reportError } from "./StatusBar";
import { Icon } from "./icons";

/** Målet: ett valgt objekt, eller den aktive mappa når hele innholdet er valgt (klikk på mappa i scenelista). */
function useTarget(objs: SceneObject[]): { id: string; name: string; folder: boolean } | null {
  const objects = useEditor((s) => s.objects);
  const folders = useEditor((s) => s.folders);
  const activeFolderId = useEditor((s) => s.activeFolderId);
  const folder = folders.find((f) => f.id === activeFolderId);
  if (folder) {
    const inside = objects.filter((o) => o.folderId && isInside(folders, o.folderId, folder.id));
    if (objs.length > 1 && objs.length === inside.length && objs.every((o) => inside.includes(o))) {
      return { id: folder.id, name: folder.name, folder: true };
    }
  }
  if (objs.length === 1) return { id: objs[0].id, name: objs[0].name, folder: false };
  return null;
}

export function AnimationPanel({ objs }: { objs: SceneObject[] }) {
  const target = useTarget(objs);
  const clips = useEditor((s) => s.clips);
  const [preset, setPreset] = useState<Preset>("spin");
  const [axis, setAxis] = useState<Axis>(PRESET_DEFAULTS.spin.axis);
  const [amount, setAmount] = useState(String(PRESET_DEFAULTS.spin.amount));
  const [duration, setDuration] = useState(String(PRESET_DEFAULTS.spin.duration));

  if (!target) {
    return (
      <div className="row">
        <div className="section-title">Animasjon</div>
        <p className="hint">Velg ett objekt, eller klikk på en mappe i scenelista for å animere alt i den sammen.</p>
      </div>
    );
  }

  const mine = clips.filter((c) => c.tracks.some((t) => t.target === target.id));
  const pick = (p: Preset) => {
    setPreset(p);
    setAxis(PRESET_DEFAULTS[p].axis);
    setAmount(String(PRESET_DEFAULTS[p].amount));
    setDuration(String(PRESET_DEFAULTS[p].duration));
  };
  const add = () => {
    try {
      const clipsAfter = useEditor.getState().addAnimation(target.id, preset, {
        axis,
        amount: Number(amount.replace(",", ".")),
        duration: Number(duration.replace(",", ".")),
      });
      // Vis den nye bevegelsen med en gang.
      const name = preset === "open" ? "Åpne" : PRESET_LABELS[preset];
      const clip = clipsAfter.find((c) => c.name === name && c.tracks.some((t) => t.target === target.id));
      if (clip) {
        usePlayer.getState().select(clip.id);
        usePlayer.getState().play();
      }
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="row anim-panel">
      <div className="section-title">Animasjon</div>
      <p className="hint">
        {target.folder ? (
          <>
            Mappa «{target.name}» beveger seg rundt en markør-node som heter <b>pivot</b> (hengsel, aksel), ellers rundt
            midten under innholdet.
          </>
        ) : (
          <>«{target.name}» beveger seg rundt sitt eget midtpunkt. Legg delene i en mappe med en pivot-node for hengsler.</>
        )}
      </p>

      {mine.length > 0 && (
        <div className="anim-clips">
          {mine.map((c) => (
            <button
              key={c.id}
              className="anim-clip"
              title={`Spill av «${c.name}»`}
              onClick={() => {
                usePlayer.getState().select(c.id);
                usePlayer.getState().play();
              }}
            >
              <Icon name="play" size={10} /> {c.name}
            </button>
          ))}
          <button className="anim-clip danger" title="Fjern all animasjon fra dette målet" onClick={() => useEditor.getState().removeAnimations(target.id)}>
            <Icon name="trash" size={11} />
          </button>
        </div>
      )}

      <div className="anim-presets">
        {PRESETS.map((p) => (
          <button key={p} className={`anim-preset ${preset === p ? "active" : ""}`} onClick={() => pick(p)}>
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="anim-options">
        <label>
          Akse
          <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        <label>
          {PRESET_DEFAULTS[preset].unit[0].toUpperCase() + PRESET_DEFAULTS[preset].unit.slice(1)}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Sekunder
          <input value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      <button className="anim-add" onClick={add}>
        Legg til {PRESET_LABELS[preset].toLowerCase()}
        {preset === "open" ? " (klippene «Åpne» og «Lukke»)" : ""}
      </button>
    </div>
  );
}
