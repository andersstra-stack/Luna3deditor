// Minimer/maksimer/lukk for det rammeløse vinduet (decorations: false). Samme oppsett
// som LunaChat (components/TitleBar.tsx): knappene ligger helt til høyre i hovedraden,
// og tomme flater med data-tauri-drag-region flytter vinduet (dobbeltklikk maksimerer).

import { useEffect, useState } from "react";

/** Kjører vi i Tauri (ekte vindu), eller i en vanlig nettleser? */
export const hasNativeWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Setter tittelen i oppgavelinja (synlig selv om vinduet ikke har egen ramme). */
export function setWindowTitle(title: string) {
  document.title = title;
  if (hasNativeWindow) win().then((w) => w.setTitle(title)).catch(() => {});
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!hasNativeWindow) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const w = await win();
      if (cancelled) return;
      w.isMaximized().then(setMaximized).catch(() => {});
      unlisten = await w.onResized(() => {
        w.isMaximized().then(setMaximized).catch(() => {});
      });
      if (cancelled && unlisten) unlisten();
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Nettleser: ingen ekte vindu å styre.
  if (!hasNativeWindow) return null;

  return (
    <div className="titlebar-controls">
      <button className="titlebar-btn" onClick={() => win().then((w) => w.minimize())} aria-label="Minimer" title="Minimer">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="titlebar-btn"
        onClick={() => win().then((w) => w.toggleMaximize())}
        aria-label={maximized ? "Gjenopprett" : "Maksimer"}
        title={maximized ? "Gjenopprett" : "Maksimer"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="2" y="0.5" width="7.5" height="7.5" fill="none" stroke="currentColor" />
            <rect x="0.5" y="2" width="7.5" height="7.5" fill="none" stroke="currentColor" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </svg>
        )}
      </button>
      <button className="titlebar-btn titlebar-btn-close" onClick={() => win().then((w) => w.close())} aria-label="Lukk" title="Lukk">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" />
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}
