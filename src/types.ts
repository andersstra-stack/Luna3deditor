export type Vec3 = [number, number, number];

export const SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"] as const;
export type ShapeType = (typeof SHAPES)[number];

export const SHAPE_LABELS: Record<ShapeType, string> = {
  box: "Kube",
  sphere: "Kule",
  cylinder: "Sylinder",
  cone: "Kjegle",
  torus: "Smultring",
  plane: "Plan",
  capsule: "Kapsel",
};

/**
 * Ett objekt i scenen. Alle primitiver er enhetsstore (passer i en 1×1×1-boks
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
}

export type TransformMode = "translate" | "rotate" | "scale";

export interface SceneFile {
  format: "luna3d";
  version: 1;
  objects: SceneObject[];
}

export const DEFAULT_COLORS = ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#7dcfff", "#ff9e64"];
