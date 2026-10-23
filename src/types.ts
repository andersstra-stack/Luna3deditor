// Holdes fri for imports – MCP-serveren importerer formlistene direkte.

export type Vec3 = [number, number, number];

export const BASIC_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"] as const;
export const EXTRA_SHAPES = ["wedge", "prism", "pyramid", "stairs", "hemisphere", "tube", "roundedBox"] as const;
export const LIGHTS = ["pointLight", "spotLight"] as const;
/** Former og lys som kan legges til direkte (verktøylinja, MCP add_objects). */
export const ADDABLE_SHAPES = [...BASIC_SHAPES, ...EXTRA_SHAPES, ...LIGHTS] as const;
/** Alle objekttyper. "mesh" er en importert modell (FBX/GLB/OBJ/STL) med geometri i et modellregister. */
export const SHAPES = [...ADDABLE_SHAPES, "mesh"] as const;
export type ShapeType = (typeof SHAPES)[number];

export const isLight = (t: ShapeType) => t === "pointLight" || t === "spotLight";

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
  pointLight: "Punktlys",
  spotLight: "Spotlys",
  mesh: "Modell",
};

/** Standardstørrelse når formen legges til (scale = størrelse i meter). */
export const DEFAULT_SCALE: Partial<Record<ShapeType, Vec3>> = {
  hemisphere: [1, 0.5, 1],
  pointLight: [0.25, 0.25, 0.25],
  spotLight: [0.3, 0.3, 0.3],
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
  pointLight: "xyz",
  spotLight: "xz",
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
  /** Kun importerte modeller: id i modellregisteret (se meshes.ts). */
  meshId?: string;
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
}

/** Mapper er kun for organisering – de har ingen egen posisjon. */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
}

export type TransformMode = "translate" | "rotate" | "scale";

export interface SceneFile {
  format: "luna3d";
  version: 3;
  objects: SceneObject[];
  folders: Folder[];
  /** Geometri for importerte modeller (versjon 3+). */
  meshes?: SerializedMesh[];
}

export interface SerializedMesh {
  id: string;
  name: string;
  positions: string;
  normals: string;
  index?: string;
}

export const DEFAULT_COLORS = ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#7dcfff", "#ff9e64"];
