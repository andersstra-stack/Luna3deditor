import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { confirmDiscard } from "../io";
import { reportError } from "./StatusBar";
import { hasNativeWindow } from "./WindowControls";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number | null };

/** Sjekker lunaeco.no/updates/luna3d/latest.json ved oppstart. Finnes en nyere, signert
 *  versjon vises en knapp i statuslinja; klikk = spør om ulagrede endringer, last ned,
 *  installer og start på nytt. */
export function UpdateButton() {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!hasNativeWindow) return;
    let cancelled = false;
    (async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update && !cancelled) setState({ kind: "available", update });
    })().catch((e) => console.warn("Oppdateringssjekk feilet:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "idle") return null;

  if (state.kind === "downloading") {
    return (
      <span className="update-btn busy">
        Laster ned{state.percent !== null ? ` ${state.percent} %` : "…"}
      </span>
    );
  }

  const { update } = state;
  const install = async () => {
    if (!(await confirmDiscard())) return;
    let total: number | null = null;
    let done = 0;
    setState({ kind: "downloading", percent: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? null;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "downloading", percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ kind: "available", update });
      reportError(e);
    }
  };

  return (
    <button className="update-btn" title={update.body || undefined} onClick={install}>
      Oppdater til v{update.version}
    </button>
  );
}
