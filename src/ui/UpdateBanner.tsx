import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { confirmDiscard } from "../io";
import { reportError } from "./StatusBar";
import { Icon } from "./icons";
import { hasNativeWindow } from "./WindowControls";

/** Så ofte appen ser etter en ny versjon mens den står åpen (i tillegg til ved oppstart). */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; percent: number | null };

/** Linje rett under tittellinja når lunaeco.no/updates/luna3d/latest.json har en nyere, signert versjon.
 *  «Oppdater nå» = spør om ulagrede endringer, last ned, installer og start på nytt. Lukkes for denne
 *  versjonen med krysset. Den tomme plassen er alltid i DOM-en så rutenettet i `.app` står likt. */
export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!hasNativeWindow) return;
    let cancelled = false;
    const run = async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update && !cancelled)
        setState((s) => (s.kind === "downloading" ? s : { kind: "available", update }));
    };
    const tick = () => run().catch((e) => console.warn("Oppdateringssjekk feilet:", e));
    tick();
    const timer = setInterval(tick, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.kind === "idle" || (state.kind === "available" && state.update.version === dismissed))
    return <div className="update-slot" />;

  const { update } = state;
  const install = async () => {
    if (!(await confirmDiscard())) return;
    let total: number | null = null;
    let done = 0;
    setState({ kind: "downloading", update, percent: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? null;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "downloading", update, percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ kind: "available", update });
      reportError(e);
    }
  };

  const downloading = state.kind === "downloading";
  return (
    <div className="update-slot">
      <div className="update-banner" role="status" aria-live="polite">
        <span className="update-banner-icon">
          <Icon name="import" size={14} />
        </span>
        <span className="update-banner-text">
          {downloading ? (
            <>Laster ned Luna 3D v{update.version}{state.percent !== null ? ` – ${state.percent} %` : "…"}</>
          ) : (
            <>
              <b>Luna 3D v{update.version} er klar.</b>
              {update.body && <span className="update-banner-notes"> {update.body}</span>}
            </>
          )}
        </span>
        {downloading ? (
          <span className="update-banner-progress">
            <span style={{ width: `${state.percent ?? 0}%` }} />
          </span>
        ) : (
          <>
            <button className="update-banner-action" onClick={install}>
              Oppdater nå
            </button>
            <button className="update-banner-dismiss" title="Ikke nå" onClick={() => setDismissed(update.version)}>
              <Icon name="close" size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
