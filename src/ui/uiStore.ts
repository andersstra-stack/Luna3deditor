// UI-tilstand som ikke hører til scenen: tema, innstillinger og innstillingsdialogen.
// Tema-oppsettet følger LunaChat (store/ui.ts): data-theme på <html>, valget i localStorage,
// og et inline-skript i index.html setter lagret tema før appen tegnes (ingen blink).

import { create } from "zustand";

export type Theme =
  | "blue" | "dark" | "light" | "purple"
  | "nord" | "dracula" | "gruvbox" | "tokyonight" | "solarized" | "forest";

export interface ThemeDef {
  id: Theme;
  label: string;
  swatch: { bg: string; panel: string; accent: string; text: string };
}

// Samme kort/paletter som LunaChat sin AppearanceTab.
export const THEMES: ThemeDef[] = [
  { id: "blue", label: "Blå", swatch: { bg: "linear-gradient(135deg, #0a1f3c 0%, #1e5a9c 100%)", panel: "rgba(255,255,255,0.18)", accent: "#5DE0C0", text: "#ffffff" } },
  { id: "dark", label: "Mørk", swatch: { bg: "linear-gradient(135deg, #141418 0%, #1f1f26 100%)", panel: "rgba(255,255,255,0.10)", accent: "#8b8bff", text: "#ffffff" } },
  { id: "light", label: "Lys", swatch: { bg: "linear-gradient(135deg, #f3f5f9 0%, #e1e7ef 100%)", panel: "rgba(255,255,255,0.85)", accent: "#0d8f70", text: "#121a2b" } },
  { id: "purple", label: "Lilla", swatch: { bg: "linear-gradient(135deg, #2a1a4a 0%, #8c4aaa 100%)", panel: "rgba(255,255,255,0.15)", accent: "#c9a0ff", text: "#ffffff" } },
  { id: "nord", label: "Nord", swatch: { bg: "linear-gradient(135deg,#2e3440 0%,#434c5e 100%)", panel: "rgba(255,255,255,0.12)", accent: "#88c0d0", text: "#eceff4" } },
  { id: "dracula", label: "Dracula", swatch: { bg: "linear-gradient(135deg,#282a36 0%,#44475a 100%)", panel: "rgba(255,255,255,0.12)", accent: "#bd93f9", text: "#f8f8f2" } },
  { id: "gruvbox", label: "Gruvbox", swatch: { bg: "linear-gradient(135deg,#282828 0%,#3c3836 100%)", panel: "rgba(255,255,255,0.10)", accent: "#fabd2f", text: "#ebdbb2" } },
  { id: "tokyonight", label: "Tokyo Night", swatch: { bg: "linear-gradient(135deg,#1a1b26 0%,#24283b 100%)", panel: "rgba(255,255,255,0.10)", accent: "#7aa2f7", text: "#c0caf5" } },
  { id: "solarized", label: "Solarized", swatch: { bg: "linear-gradient(135deg,#002b36 0%,#073642 100%)", panel: "rgba(255,255,255,0.10)", accent: "#2aa198", text: "#eee8d5" } },
  { id: "forest", label: "Skog", swatch: { bg: "linear-gradient(135deg,#0c1f17 0%,#1c3d2e 100%)", panel: "rgba(255,255,255,0.10)", accent: "#34d399", text: "#e6f5ee" } },
];

const VALID_THEMES = THEMES.map((t) => t.id) as readonly Theme[];
const THEME_KEY = "luna3d.theme";
const DEFAULT_THEME: Theme = "blue";

function readSavedTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v !== null && (VALID_THEMES as readonly string[]).includes(v)) return v as Theme;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

const KEEP_ORIGIN_KEY = "luna3d.importKeepOrigin";
const DETAIL_KEY = "luna3d.geometryDetail";

/** Hvor glatte formene (kuler, sylindre …) er: glatt for visning, lavpoly for spill. */
export type GeometryDetail = "smooth" | "lowpoly";

function readDetail(): GeometryDetail {
  try {
    return window.localStorage.getItem(DETAIL_KEY) === "lowpoly" ? "lowpoly" : "smooth";
  } catch {
    return "smooth";
  }
}

function readKeepOrigin(): boolean {
  try {
    return window.localStorage.getItem(KEEP_ORIGIN_KEY) === "1";
  } catch {
    return false;
  }
}

function applyThemeToDom(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Import: legg filas origo i scenens origo i stedet for å sentrere modellen der kameraet ser. */
  importKeepOrigin: boolean;
  setImportKeepOrigin: (on: boolean) => void;
  geometryDetail: GeometryDetail;
  setGeometryDetail: (d: GeometryDetail) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUi = create<UiState>((set) => ({
  theme: readSavedTheme(),
  setTheme: (t) => {
    applyThemeToDom(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
    set({ theme: t });
  },
  importKeepOrigin: readKeepOrigin(),
  setImportKeepOrigin: (on) => {
    try {
      window.localStorage.setItem(KEEP_ORIGIN_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ importKeepOrigin: on });
  },
  geometryDetail: readDetail(),
  setGeometryDetail: (d) => {
    try {
      window.localStorage.setItem(DETAIL_KEY, d);
    } catch {
      /* ignore */
    }
    set({ geometryDetail: d });
  },
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));

/** Farger fra aktivt tema, for ting som ikke kan bruke CSS (3D-visningen). */
export function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bgPage: get("--bg-page", "#06112a"),
    accent: get("--accent", "#5DE0C0"),
    text: get("--text-strong", "#ffffff"),
  };
}
