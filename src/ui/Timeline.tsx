// Tidslinje nederst i 3D-visningen: velg klipp, spill av, dra i tiden. Synes bare når scenen har animasjoner.

import { useEffect, useMemo } from "react";
import { primaryId, useEditor } from "../store";
import { usePlayer } from "../animationPlayer";
import { Icon } from "./icons";

const seconds = (t: number) => `${t.toFixed(2).replace(".", ",")} s`;

export function Timeline() {
  const clips = useEditor((s) => s.clips);
  const pid = useEditor(primaryId);
  const activeFolderId = useEditor((s) => s.activeFolderId);
  const { clipId, time, playing, select, setTime, play, pause, stop } = usePlayer();
  const clip = clips.find((c) => c.id === clipId) ?? null;

  // Klippet ble slettet (eller angret bort): tilbake til hvileposisjon.
  useEffect(() => {
    if (clipId && !clip) select(null);
  }, [clipId, clip, select]);

  // Nøkkelrammene for det valgte objektet (eller den aktive mappa), ellers alle i klippet.
  const ticks = useMemo(() => {
    if (!clip) return [];
    const mine = clip.tracks.filter((t) => t.target === pid || t.target === activeFolderId);
    const times = new Set((mine.length ? mine : clip.tracks).flatMap((t) => t.keys.map((k) => k.t)));
    return [...times].filter((t) => t <= clip.duration);
  }, [clip, pid, activeFolderId]);

  if (!clips.length) return null;

  return (
    <div className="timeline">
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
      <div className="timeline-track">
        {clip &&
          ticks.map((t) => <span key={t} className="timeline-tick" style={{ left: `${(t / clip.duration) * 100}%` }} title={seconds(t)} />)}
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
