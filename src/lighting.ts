// Scenens lysoppsett: omgivelseslys, sol, fyll- og kantlys og miljølys. Hører til scenen (scenefila og angre-historikken),
// så hvert prosjekt beholder sitt lys. Standardoppsettet skrives ikke til fila og gir samme bilde som før oppsettet fantes.
// Bare visning og ikoner: GLB-eksporten tar ikke med dette lyset.

export const LIGHT_PRESETS = ["standard", "studio", "overcast", "evening"] as const;
export type LightPreset = (typeof LIGHT_PRESETS)[number];

export interface Lighting {
  /** Ferdig oppsett, eller "custom" når verdiene er justert for hånd. */
  preset: LightPreset | "custom";
  /** Omgivelseslys fra himmel og bakke. */
  ambient: number;
  /** Solas styrke. */
  sun: number;
  /** Solas retning i grader rundt figuren: 0 = forfra (+Z), 90 = fra +X, 180 = bakfra. Fyll- og kantlys følger med. */
  sunAzimuth: number;
  /** Solas høyde i grader over horisonten. */
  sunElevation: number;
  sunColor: string;
  /** Mykt lys fra motsatt side av sola, uten skygger: løfter skyggesiden. */
  fill: number;
  /** Lys bakfra, uten skygger: tegner omrisset. */
  rim: number;
  /** Miljølys fra alle kanter, med refleksjoner i blanke flater. */
  environment: number;
}

const WHITE = "#ffffff";

export const DEFAULT_LIGHTING: Lighting = {
  preset: "standard",
  ambient: 0.9,
  sun: 2.2,
  sunAzimuth: 36.87,
  sunElevation: 50.19,
  sunColor: WHITE,
  fill: 0,
  rim: 0,
  environment: 0,
};

const PRESET_VALUES: Record<LightPreset, Lighting> = {
  standard: DEFAULT_LIGHTING,
  studio: { preset: "studio", ambient: 0.2, sun: 2.1, sunAzimuth: 32, sunElevation: 38, sunColor: "#fff3e4", fill: 0.45, rim: 1.5, environment: 0.3 },
  overcast: { preset: "overcast", ambient: 0.75, sun: 0.7, sunAzimuth: 20, sunElevation: 65, sunColor: "#eef3ff", fill: 0.3, rim: 0.3, environment: 0.7 },
  evening: { preset: "evening", ambient: 0.3, sun: 3, sunAzimuth: 68, sunElevation: 14, sunColor: "#ffb877", fill: 0.35, rim: 0.9, environment: 0.25 },
};

export const PRESET_LABELS: Record<LightPreset, { label: string; title: string }> = {
  standard: { label: "Standard", title: "Slik Luna 3D alltid har vist scener" },
  studio: { label: "Studio", title: "Tre-punkts lys med miljølys: tydelig form fra alle kanter" },
  overcast: { label: "Overskyet", title: "Mykt lys uten harde skygger" },
  evening: { label: "Kveld", title: "Lav, varm sol og lange skygger" },
};

/** Tillatte områder; også grensene på glidebrytere i lysmenyen. */
export const LIGHT_RANGES = {
  ambient: [0, 2],
  sun: [0, 6],
  sunAzimuth: [0, 360],
  sunElevation: [5, 90],
  fill: [0, 3],
  rim: [0, 4],
  environment: [0, 2],
} as const;

type NumberKey = keyof typeof LIGHT_RANGES;
const NUMBER_KEYS = Object.keys(LIGHT_RANGES) as NumberKey[];
const round = (v: number) => Math.round(v * 100) / 100;

export type LightingChange = Partial<Omit<Lighting, "preset">> & { preset?: string };

/**
 * Nytt oppsett fra en endring. Med `preset` er det utgangspunktet; andre verdier legges oppå og gjør det til "custom".
 * Tall utenfor området holdes innenfor, ugyldige verdier kaster feil. Retningen tar også negative grader.
 */
export function changeLighting(current: Lighting, change: LightingChange): Lighting {
  let next = current;
  if (change.preset !== undefined) {
    if (!(LIGHT_PRESETS as readonly string[]).includes(change.preset)) {
      throw new Error(`Ukjent lysoppsett «${change.preset}». Gyldige: ${LIGHT_PRESETS.join(", ")}`);
    }
    next = PRESET_VALUES[change.preset as LightPreset];
  }
  const values: Partial<Lighting> = {};
  for (const key of NUMBER_KEYS) {
    const v = change[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} må være et tall`);
    const [min, max] = LIGHT_RANGES[key];
    values[key] = key === "sunAzimuth" ? round(((v % 360) + 360) % 360) : round(Math.min(max, Math.max(min, v)));
  }
  if (change.sunColor !== undefined) {
    if (typeof change.sunColor !== "string" || !/^#[0-9a-f]{6}$/i.test(change.sunColor)) throw new Error("Solfargen må være en hex-farge som #ffaa77");
    values.sunColor = change.sunColor.toLowerCase();
  }
  return Object.keys(values).length ? { ...next, ...values, preset: "custom" } : next;
}

/** Lyset fra en scenefil. Mangler det eller er det ugyldig, brukes standardoppsettet. */
export function lightingFromFile(data: unknown): Lighting {
  if (!data || typeof data !== "object") return DEFAULT_LIGHTING;
  const { preset, ...values } = data as Lighting;
  try {
    const base = (LIGHT_PRESETS as readonly string[]).includes(preset) ? { preset: preset as string } : {};
    const read = changeLighting(DEFAULT_LIGHTING, { ...base, ...values });
    return { ...read, preset: base.preset ? (preset as LightPreset) : read.preset };
  } catch {
    return DEFAULT_LIGHTING;
  }
}

/** Retning mot lyset, som enhetsvektor. Azimut og høyde i grader. */
export function lightDirection(azimuth: number, elevation: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}
