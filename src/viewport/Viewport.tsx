import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, Outlines, TransformControls } from "@react-three/drei";
import { useEditor } from "../store";
import { hiddenFolderIds } from "../folders";
import type { SceneObject, Vec3 } from "../types";
import { getGeometry } from "./geometries";
import { setThreeGetter } from "./three-handle";

const DEG = Math.PI / 180;
const round = (v: number, step: number) => Math.round(v / step) * step;

// Et klikk på gizmoen skal ikke telle som klikk i tomrommet (som fjerner utvalget).
let lastGizmoInteraction = 0;
const gizmoRecentlyUsed = () => performance.now() - lastGizmoInteraction < 250;

function readTransform(o: THREE.Object3D): Pick<SceneObject, "position" | "rotation" | "scale"> {
  return {
    position: o.position.toArray().map((v) => round(v, 0.001)) as Vec3,
    rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => round(v / DEG, 0.01)) as Vec3,
    scale: o.scale.toArray().map((v) => round(v, 0.001)) as Vec3,
  };
}

function Gizmo({ object, id }: { object: THREE.Object3D; id: string }) {
  const mode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const { pushHistory, updateObjectLive } = useEditor.getState();
  return (
    <TransformControls
      object={object}
      mode={mode}
      size={0.9}
      translationSnap={snap ? 0.25 : null}
      rotationSnap={snap ? 15 * DEG : null}
      scaleSnap={snap ? 0.1 : null}
      onMouseDown={() => {
        lastGizmoInteraction = performance.now();
        pushHistory();
      }}
      onMouseUp={() => (lastGizmoInteraction = performance.now())}
      onObjectChange={() => updateObjectLive(id, readTransform(object))}
    />
  );
}

function ObjectMesh({ obj, selected, visible }: { obj: SceneObject; selected: boolean; visible: boolean }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const select = useEditor((s) => s.select);
  const transparent = obj.opacity < 1;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!gizmoRecentlyUsed()) select(obj.id);
  };

  return (
    <>
      <mesh
        ref={setMesh}
        name={obj.name}
        userData={{ lunaId: obj.id }}
        geometry={getGeometry(obj.type)}
        position={obj.position}
        rotation={obj.rotation.map((d) => d * DEG) as Vec3}
        scale={obj.scale}
        visible={visible}
        castShadow
        receiveShadow
        onClick={onClick}
      >
        <meshStandardMaterial
          color={obj.color}
          metalness={obj.metalness}
          roughness={obj.roughness}
          transparent={transparent}
          opacity={obj.opacity}
          depthWrite={!transparent}
          side={obj.type === "plane" ? THREE.DoubleSide : THREE.FrontSide}
        />
        {/* drei 10 har byttet om grenene i shaderen: uten `screenspace` er tykkelsen i piksler. */}
        {selected && <Outlines thickness={3} color="#ffb454" />}
      </mesh>
      {selected && mesh && visible && <Gizmo object={mesh} id={obj.id} />}
    </>
  );
}

function ThreeBridge() {
  const get = useThree((s) => s.get);
  useEffect(() => setThreeGetter(get), [get]);
  return null;
}

function Scene() {
  const objects = useEditor((s) => s.objects);
  const folders = useEditor((s) => s.folders);
  const selectedId = useEditor((s) => s.selectedId);
  const hidden = useMemo(() => hiddenFolderIds(folders), [folders]);
  return (
    <>
      {objects.map((o) => (
        <ObjectMesh
          key={o.id}
          obj={o}
          selected={o.id === selectedId}
          visible={o.visible && !(o.folderId && hidden.has(o.folderId))}
        />
      ))}
    </>
  );
}

export function Viewport() {
  const select = useEditor((s) => s.select);
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [6, 5, 8], fov: 50, near: 0.05, far: 1000 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onPointerMissed={(e) => {
        if (e.button === 0 && !gizmoRecentlyUsed()) select(null);
      }}
    >
      <ThreeBridge />
      <color attach="background" args={["#1d2030"]} />
      <hemisphereLight args={["#dfe6ff", "#3a3326", 0.9]} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0004}
      />
      {/* Usynlig bakke som bare fanger skygger */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002} receiveShadow raycast={() => null}>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
      <Grid
        position={[0, -0.001, 0]}
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor="#3b4060"
        sectionColor="#5a6190"
        fadeDistance={60}
        fadeStrength={1.5}
      />
      <Scene />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={["#f7768e", "#9ece6a", "#7aa2f7"]} labelColor="#1d2030" />
      </GizmoHelper>
    </Canvas>
  );
}
