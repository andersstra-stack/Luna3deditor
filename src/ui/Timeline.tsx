// Tidslinje nederst i 3D-visningen: velg klipp, spill av, dra i tiden. Synes bare når scenen har animasjoner.
// Med et klipp valgt setter gizmoen nøkkelrammer («Opptak»), og rammene på linja kan dras eller slettes.

import { useEffect, useMemo, useRef } from "react";
import { primaryId, useEditor } from "../store";
import { usePlayer } from "../animationPlayer";
import { deleteKeysAt, moveKeys } from "../animation";
import { Icon } from "./icons";

const seconds = (t: number) => `${t.toFixed(2).replace(".", ",")} s`;

export function Timeline() {
  const clips = useEditor((s) => s.clips);
  const pid = useEditor(primaryId);
  const activeFolderId = useEditor((s) => s.activeFolderId);
  const { clipId, time, playing, select, setTime, play, pause, stop } = usePlayer();
  const clip = clips.find((c) => c.id === clipId) ?? null;
  const trackRef = useRef<HTMLDivElement>(null);

  // Klippet ble slettet (eller angret bort): tilbake til hvileposisjon.
  useEffect(() => {
    if (clipId && !clip) select(null);
  }, [clipId, clip, select]);

  // Nøkkelrammene for det valgte objektet (eller den aktive mappa), ellers alle i klippet.
  const { ticks, targets } = useMemo(() => {
    if (!clip) return { ticks: [] as number[], targets: [] as string[] };
    const mine = clip.tracks.filter((t) => t.target === pid || t.target === activeFolderId);
    const times = new Set((mine.length ? mine : clip.tracks).flatMap((t) => t.keys.map((k) => k.t)));
    return { ticks: [...times].filter((t) => t <= clip.duration).sort((a, b) => a - b), targets: mine.map((t) => t.target) };
  }, [clip, pid, activeFolderId]);

  if (!clips.length) return null;

  /** Dra en nøkkelramme langs linja (Shift = finere trinn). Et klikk uten å dra spoler bare dit. */
  const dragTick = (e: React.PointerEvent, from: number) => {
    if (!clip || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pause();
    setTime(from);
    const base = useEditor.getState().clips;
    const baseClip = clip;
    let started = false;
    const move = (ev: PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (!started) {
        if (Math.abs(ev.clientX - e.clientX) < 3) return;
        useEditor.getState().pushHistory();
        started = true;
      }
      const step = ev.shiftKey ? 0.01 : 0.05;
      const raw = ((ev.clientX - rect.left) / rect.width) * baseClip.duration;
      const to = Math.min(baseClip.duration, Math.max(0, Math.round(raw / step) * step));
      useEditor.getState().setClipsLive(base.map((c) => (c.id === baseClip.id ? moveKeys(baseClip, targets, from, to) : c)));
      setTime(to);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const removeTick = (at: number) => {
    if (!clip) return;
    const { pushHistory, setClipsLive, clips: all } = useEditor.getState();
    pushHistory();
    setClipsLive(all.map((c) => (c.id === clip.id ? deleteKeysAt(clip, targets, at) : c)));
  };

  return (
    <div className="timeline">
      {clip && (
        <span
          className="timeline-rec"
          title={`Opptak: flytt, roter eller skaler noe nå for å sette en nøkkelramme ved ${seconds(time)}. Velg «Hvileposisjon» for å endre selve modellen.`}
        >
          ● Opptak
        </span>
      )}
      <select
        className="timeline-clip"
        value={clipId ?? ""}
        title="Animasjonsklipp – «Hvileposisjon» viser scenen slik den er lagret"
        onChange={(e) => select(e.target.value || null)}
      >
        <option value="">Hvileposisjon</option>
        {clips.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.tracks.length})
          </option>
        ))}
      </select>
      <button
        className="icon-btn"
        title={playing ? "Pause (mellomrom)" : "Spill av (mellomrom)"}
        disabled={!clip}
        onClick={() => (playing ? pause() : play())}
      >
        <Icon name={playing ? "pause" : "play"} size={14} />
      </button>
      <div className="timeline-track" ref={trackRef}>
        {clip &&
          ticks.map((t) => (
            <button
              key={t}
              className="timeline-tick"
              style={{ left: `${(t / clip.duration) * 100}%` }}
              title={`${seconds(t)} – dra for å flytte (Shift = finere), dobbeltklikk for å slette`}
              onPointerDown={(e) => dragTick(e, t)}
              onDoubleClick={() => removeTick(t)}
            />
          ))}
        <input
          type="range"
          min={0}
          max={clip?.duration ?? 1}
          step={0.01}
          value={clip ? time : 0}
          disabled={!clip}
          onChange={(e) => {
            pause();
            setTime(Number(e.target.value));
          }}
        />
      </div>
      <span className="timeline-time">{clip ? `${seconds(time)} / ${seconds(clip.duration)}` : "–"}</span>
      <button
        className={`icon-btn ${clip?.loop ? "active" : ""}`}
        title={clip?.loop ? "Går i sløyfe – klikk for å spille én gang" : "Spilles én gang – klikk for sløyfe"}
        disabled={!clip}
        onClick={() => clip && useEditor.getState().updateClip(clip.id, { loop: !clip.loop })}
      >
        <Icon name="loop" size={14} />
      </button>
      <button
        className="icon-btn"
        title="Slett klippet"
        disabled={!clip}
        onClick={() => {
          if (!clip || !confirm(`Slette animasjonsklippet «${clip.name}»?`)) return;
          stop();
          useEditor.getState().deleteClips([clip.id]);
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}
