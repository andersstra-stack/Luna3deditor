// Holdes fri for imports – MCP-serveren importerer formlistene direkte.

export type Vec3 = [number, number, number];

export const BASIC_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"] as const;
export const EXTRA_SHAPES = ["wedge", "prism", "pyramid", "stairs", "hemisphere", "tube", "roundedBox", "curve"] as const;
export const LIGHTS = ["pointLight", "spotLight"] as const;
/** Markør-noder: usynlige, navngitte punkter med retning (dokking, hardpoints, spawn …) for spillmotoren. */
export const MARKERS = ["node"] as const;
/** Former, lys og noder som kan legges til direkte (verktøylinja, MCP add_objects). */
export const ADDABLE_SHAPES = [...BASIC_SHAPES, ...EXTRA_SHAPES, ...LIGHTS, ...MARKERS] as const;
/** Alle objekttyper. "mesh" er en importert modell (FBX/GLB/OBJ/STL) med geometri i et modellregister. */
export const SHAPES = [...ADDABLE_SHAPES, "mesh"] as const;
export type ShapeType = (typeof SHAPES)[number];

export const isLight = (t: ShapeType) => t === "pointLight" || t === "spotLight";
export const isNode = (t: ShapeType) => t === "node";
/** Lys og noder er hjelpere i editoren: ingen hull, ikke noe å lande på eller snappe mot. */
export const isHelper = (t: ShapeType) => isLight(t) || isNode(t);

/** Høyden en ny form settes i: lys henger i lufta, plan og noder ligger på bakken, alt annet står oppå den. */
export function startHeight(type: ShapeType, scale: Vec3): number {
  if (isLight(type)) return 2.5;
  if (type === "plane" || isNode(type)) return 0;
  return scale[1] / 2;
}

/**
 * Egendefinerte egenskaper på en node (som Custom Properties i Blender). Eksporteres som glTF `extras`.
 * Flate par med tall eller tekst – det er det Unity-siden leser (SVAR_GLB_NODER_v1.md).
 */
export type NodeProps = Record<string, string | number>;

export const SHAPE_LABELS: Record<ShapeType, string> = {
  box: "Kube",
  sphere: "Kule",
  cylinder: "Sylinder",
  cone: "Kjegle",
  torus: "Smultring",
  plane: "Plan",
  capsule: "Kapsel",
  wedge: "Kile",
  prism: "Prisme",
  pyramid: "Pyramide",
  stairs: "Trapp",
  hemisphere: "Halvkule",
  tube: "Rør",
  roundedBox: "Avrundet kube",
  curve: "Kurverør",
  pointLight: "Punktlys",
  spotLight: "Spotlys",
  node: "Node",
  mesh: "Modell",
};

/** Standardstørrelse når formen legges til (scale = størrelse i meter). */
export const DEFAULT_SCALE: Partial<Record<ShapeType, Vec3>> = {
  hemisphere: [1, 0.5, 1],
  pointLight: [0.25, 0.25, 0.25],
  spotLight: [0.3, 0.3, 0.3],
  node: [0.6, 0.6, 0.6],
};

export const DEFAULT_INTENSITY: Partial<Record<ShapeType, number>> = { pointLight: 20, spotLight: 60 };

/**
 * Lokale akser formen er speilsymmetrisk om. Brukes ved speiling: en form som
 * ikke er symmetrisk om speilaksen må i tillegg snus 180°.
 */
export const SYMMETRIC_AXES: Record<ShapeType, string> = {
  box: "xyz",
  sphere: "xyz",
  cylinder: "xyz",
  cone: "xz",
  torus: "xyz",
  plane: "xyz",
  capsule: "xyz",
  wedge: "z",
  prism: "xz",
  pyramid: "xz",
  stairs: "z",
  hemisphere: "xz",
  tube: "xyz",
  roundedBox: "xyz",
  // Kan ha hvilken som helst form: speiles med negativ størrelse, som modeller (se placement.ts).
  curve: "",
  pointLight: "xyz",
  spotLight: "xz",
  // Pila peker langs +Z og har «opp» langs +Y; speiles om lokal X (se placement.ts).
  node: "x",
  mesh: "",
};

/**
 * Ett objekt i scenen. Alle former er enhetsstore (passer i en 1×1×1-boks
 * sentrert i origo), så `scale` tilsvarer størrelsen i meter.
 * Rotasjon lagres i grader – enklere for både mennesker og Claude.
 */
export interface SceneObject {
  id: string;
  name: string;
  type: ShapeType;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  visible: boolean;
  /** Mappen objektet ligger i, eller null for scene-roten. */
  folderId: string | null;
  /** Hull skjærer seg inn i de andre (ikke-hull) objektene i samme mappe. */
  hole?: boolean;
  /** Kun lys: lysstyrke (candela). */
  intensity?: number;
  /** Glød 0–1 i objektets egen farge (vinduer, lamper, skjermer). Eksporteres som palettens `_emission`-bilde. */
  emissive?: number;
  /**
   * Materialnavn i GLB-eksporten, f.eks. "nova_glass" (Unity bytter det til sitt glass). Tomt = det felles
   * palett-materialet. Importerte modeller beholder navnet fra fila.
   */
  material?: string;
  /**
   * Kun noder: egendefinerte egenskaper, f.eks. { type: "pirate_grunt" } eller { yaw_min: -150 }.
   * Nodens lokale +Z er «forover» og +Y «opp» (samme som i Unity etter import). `scale` er bare markørstørrelsen.
   */
  props?: NodeProps;
  /** Kun sylinder: toppens diameter i forhold til bunnens, 0–1 (0 = spiss, 1/tom = rett sylinder). */
  taper?: number;
  /** Kun kurverør: punktene røret går gjennom og tykkelsen (se curves.ts). */
  curve?: Curve;
  /** Kun importerte modeller: id i modellregisteret (se meshes.ts). */
  meshId?: string;
  /** Skriptet (normalisert sti) som laget objektet – erstattes når skriptet kjøres igjen. */
  script?: string;
}

/**
 * Et rør som følger en jevn kurve gjennom punktene (greiner, røtter, kabler, tentakler). Punktene er i objektets
 * lokale koordinater i meter, sentrert i røret – geometrien normaliseres til enhetsboksen som alle andre former,
 * så `scale` er fortsatt størrelsen. Utad (MCP/Python) oppgis punktene i verdensrommet, se `placeCurve`.
 */
export interface Curve {
  points: Vec3[];
  /** Radius i meter: ett tall for hele røret, eller ett per punkt (avsmalnende). */
  radius: number | number[];
}

/**
 * Geometrien til en importert modell, normalisert til enhetsboksen (som alle andre former).
 * Tallene lagres som base64 (Float32/Uint32) i scenefila.
 */
export interface MeshAsset {
  id: string;
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  index?: Uint32Array;
  /**
   * Farge per hjørne (sRGB, 3 byte) – modeller som er slått sammen av deler med ulike farger. Uten dette har modellen
   * én farge (objektets `color`). Eksporten legger hver farge i paletten.
   */
  colors?: Uint8Array;
  /**
   * Importert tekstur (fotografiske teksturer fra AI-/skannemodeller): UV per hjørne (glTF-konvensjon, v = 0 øverst)
   * og bildet i teksturregisteret. Objektets `color` farger teksturen (hvit = som i fila).
   */
  uvs?: Float32Array;
  textureId?: string;
}

/** Et bilde i teksturregisteret (`src/meshes.ts`). Id-en er en hash av bildet, så like teksturer deles. */
export interface TextureAsset {
  id: string;
  mime: string;
  data: Uint8Array;
}

export interface SerializedTexture {
  id: string;
  mime: string;
  data: string;
}

/** Mapper er kun for organisering – de har ingen egen posisjon. */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  /**
   * Eksporteres som ÉN modell: alle deler i mappa (og undermapper som ikke selv er modeller) blir én mesh med ett
   * palett-materiale per utseende. Markør-noder blir barn av modellen; en node som heter «pivot» blir origo.
   */
  model?: boolean;
  /** Skriptet som laget mappa – gjenbrukes når skriptet kjøres igjen. */
  script?: string;
}

export type TransformMode = "translate" | "rotate" | "scale";

export type NoteAuthor = "user" | "claude";

export interface NoteReply {
  author: NoteAuthor;
  text: string;
  /** ISO-tidspunkt */
  at: string;
}

/**
 * En pinne med kommentar, festet til et punkt i scenen (helst på et objekt, så den
 * følger med når objektet flyttes). Brukes til å si «her må noe gjøres» – både av
 * brukeren og Claude.
 */
export interface Note {
  id: string;
  /** Løpenummer som vises på pinnen (og i skjermbilder). */
  number: number;
  text: string;
  author: NoteAuthor;
  status: "open" | "done";
  /** Verdensposisjon da pinnen ble satt (brukes hvis objektet er borte). */
  position: Vec3;
  objectId: string | null;
  /** Punktet i objektets lokale koordinater, så pinnen følger objektet. */
  local?: Vec3;
  createdAt: string;
  replies: NoteReply[];
}

/**
 * Én nøkkelramme: en ENDRING fra hvileposisjonen, rundt målets pivot og i pivotens egne akser – så animasjonen
 * følger med når objektet eller mappa flyttes. Kanaler som mangler interpoleres fra nabo-rammene.
 */
export interface AnimKey {
  /** Sekunder fra starten av klippet. */
  t: number;
  /** Flytting i meter. */
  position?: Vec3;
  /** Rotasjon i grader (XYZ). Interpoleres lineært, så 360 er én hel runde. */
  rotation?: Vec3;
  /** Størrelsesfaktor (1 = uendret). */
  scale?: Vec3;
  /** Overgangen FRA denne rammen til neste: jevn (myk start og stopp) eller lineær (standard). */
  ease?: "linear" | "smooth";
}

/** Nøkkelrammene for ett mål: et objekt (roterer om sitt eget midtpunkt) eller en mappe (om noden «pivot»). */
export interface AnimTrack {
  target: string;
  keys: AnimKey[];
}

/** Et navngitt animasjonsklipp («Åpne», «Snurr» …) – blir én glTF-animasjon som spillet spiller etter navn. */
export interface AnimClip {
  id: string;
  name: string;
  /** Lengde i sekunder. */
  duration: number;
  loop: boolean;
  tracks: AnimTrack[];
}

export interface SceneFile {
  format: "luna3d";
  version: 3;
  objects: SceneObject[];
  folders: Folder[];
  /** Geometri for importerte modeller (versjon 3+). */
  meshes?: SerializedMesh[];
  /** Teksturene modellene bruker (base64). */
  textures?: SerializedTexture[];
  /** Kommentar-pinner. */
  notes?: Note[];
  /** Animasjonsklipp. */
  clips?: AnimClip[];
}

export interface SerializedMesh {
  id: string;
  name: string;
  positions: string;
  normals: string;
  index?: string;
  colors?: string;
  uvs?: string;
  textureId?: string;
}

/**
 * Endringer fra et Python-skript (scripting/luna3d.py). Nøkler som begynner med «@» peker på
 * mapper/objekter laget tidligere i samme skript; ellers er det id-er fra scenen.
 */
export type ScriptOp =
  | { op: "folder"; key: string; name: string; parent?: string | null; model?: boolean }
  | { op: "add"; key: string; type: ShapeType; props: Record<string, unknown> }
  | { op: "update"; id: string; props: Record<string, unknown> }
  | { op: "delete"; ids: string[] }
  | { op: "animate"; target: string; preset: string; options?: Record<string, unknown> }
  | { op: "keyframes"; target: string; clip: string; keys: unknown[]; duration?: number; loop?: boolean };

export interface ScriptResult {
  /** Objekter fra forrige kjøring av samme skript som ble fjernet. */
  replaced: number;
  created: string[];
  folders: string[];
  updated: number;
  deleted: number;
  /** Animasjonsspor som ble lagt til eller byttet ut. */
  animated: number;
  /** Skriptets nøkler (@o1, @f1 …) → id-er i scenen. */
  keys: Record<string, string>;
}

export const DEFAULT_COLORS = ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#7dcfff", "#ff9e64"];
