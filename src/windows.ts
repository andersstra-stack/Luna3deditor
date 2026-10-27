// Flere prosjektvinduer: hvert vindu har sin egen scene, angrehistorikk og 3D-visning (egen JS-kontekst), og kobler
// seg til MCP-huben for seg selv – så flere Claude-økter kan jobbe i hvert sitt prosjekt samtidig.
import { invoke } from "@tauri-apps/api/core";
import { openScene } from "./io";
import { reportError } from "./ui/StatusBar";
import { hasNativeWindow } from "./ui/WindowControls";

declare global {
  interface Window {
    /** Fila et nytt vindu skal åpne – satt av Rust (`open_project_window`) før siden lastes. */
    __LUNA_OPEN__?: string | null;
  }
}

let startup: Promise<void> | null = null;

/** Åpner fila vinduet ble laget for (én gang). Broen venter på dette, så huben ser riktig fil fra start. */
export function openStartupFile(): Promise<void> {
  return (startup ??= (async () => {
    const path = window.__LUNA_OPEN__;
    if (path) await openScene(path).catch(reportError);
  })());
}

/** Etiketten Tauri kjenner vinduet ved (unik per vindu; «main» for det første). */
export async function windowLabel(): Promise<string> {
  if (!hasNativeWindow) return `nettleser-${Math.random().toString(36).slice(2, 8)}`;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

/** Åpner et nytt prosjektvindu, eventuelt med en scenefil. Gir etiketten til det nye vinduet. */
export function openWindow(path?: string): Promise<string> {
  if (!hasNativeWindow) return Promise.reject(new Error("Nye vinduer krever Luna 3D-appen (ikke nettleseren)"));
  return invoke<string>("open_project_window", { path: path ?? null });
}
