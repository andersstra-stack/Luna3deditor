import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, Outlines, TransformControls } from "@react-three/drei";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { useEditor } from "../store";
import { hiddenFolderIds } from "../folders";
import { boxOf, objectBox, objectMatrix, round } from "../bounds";
import { isHelper, isLight, isNode, type SceneObject, type Vec3 } from "../types";
import { geometryOf, getGeometry } from "./geometries";
import { cutGeometry, overlappingHoles } from "./csg";
import { snapOffset, type SnapContext } from "./snapping";
import { setThreeGetter } from "./three-handle";
import { NoteGroundCatcher, NotePins, placeNote } from "./Notes";
import { FlyControls } from "./FlyControls";
import { themeColors, useUi } from "../ui/uiStore";

const DEG = Math.PI / 180;

// Et klikk på gizmoen skal ikke telle som klikk i tomrommet (som fjerner utvalget).
let lastGizmoInteraction = 0;
const gizmoRecentlyUsed = () => performance.now() - lastGizmoInteraction < 250;

/**
 * Skyggefangeren på bakken viser bare skygger fra sola. En vanlig ShadowMaterial tar med
 * alle lys, og da ble alt et punktlys ikke nådde (f.eks. utenfor veggene til en hytte med
 * lampe inne) mørklagt helt ut i horisonten. Punkt- og spotlys kaster fortsatt skygger på
 * de faktiske objektene.
 */
const groundShadowMaterial = new THREE.ShadowMaterial({ opacity: 0.28 });
groundShadowMaterial.onBeforeCompile = (shader) => {
  const sunOnly = THREE.ShaderChunk.shadowmask_pars_fragment
    .replace(/#if NUM_SPOT_LIGHT_SHADOWS > 0[^\n]*/, "#if 0")
    .replace(/#if NUM_POINT_LIGHT_SHADOWS > 0[^\n]*/, "#if 0");
  shader.fragmentShader = shader.fragmentShader.replace("#include <shadowmask_pars_fragment>", sunOnly);
};
groundShadowMaterial.customProgramCacheKey = () => "luna-sun-shadows-only";

/** Synlige objekter, med skjulte mapper tatt hensyn til. */
export function useVisibleObjects() {
  const objects = useEditor((s) => s.objects);
  const folders = useEditor((s) => s.folders);
  return useMemo(() => {
    const hidden = hiddenFolderIds(folders);
    return objects.filter((o) => o.visible && !(o.folderId && hidden.has(o.folderId)));
  }, [objects, folders]);
}

function decompose(m: THREE.Matrix4): Pick<SceneObject, "position" | "rotation" | "scale"> {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return {
    position: p.toArray().map((v) => round(v)) as Vec3,
    rotation: [e.x, e.y, e.z].map((v) => round(v / DEG, 0.01)) as Vec3,
    scale: s.toArray().map((v) => round(v)) as Vec3,
  };
}

/**
 * Gizmoen sitter på et usynlig "proxy"-objekt midt i utvalget. Når proxyen
 * flyttes, får alle valgte objekter samme endring – slik flyttes hele mapper.
 */
function SelectionGizmo({ visible }: { visible: SceneObject[] }) {
  const selectedIds = useEditor((s) => s.selectedIds);
  const mode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const objectSnap = useEditor((s) => s.objectSnap);
  const camera = useThree((s) => s.camera);
  const [proxy] = useState(() => new THREE.Object3D());
  const controls = useRef<TransformControlsImpl>(null);
  const drag = useRef<{
    proxyInverse: THREE.Matrix4;
    startPos: THREE.Vector3;
    items: { id: string; matrix: THREE.Matrix4 }[];
    snap: SnapContext;
  } | null>(null);

  const selected = useMemo(() => visible.filter((o) => selectedIds.includes(o.id)), [visible, selectedIds]);

  // Plasser proxyen på utvalget (men ikke midt i en dra-operasjon).
  useLayoutEffect(() => {
    if (drag.current || !selected.length) return;
    if (selected.length === 1) {
      const o = selected[0];
      proxy.position.set(...o.position);
      proxy.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    } else {
      boxOf(selected).getCenter(proxy.position);
      proxy.rotation.set(0, 0, 0);
    }
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld();
  }, [selected, proxy]);

  if (!selected.length) return null;

  const { pushHistory, updateObjectsLive } = useEditor.getState();

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        ref={controls}
        object={proxy}
        mode={mode}
        size={0.9}
        translationSnap={snap ? 0.25 : null}
        rotationSnap={snap ? 15 * DEG : null}
        scaleSnap={snap ? 0.1 : null}
        onMouseDown={() => {
          lastGizmoInteraction = performance.now();
          pushHistory();
          proxy.updateMatrixWorld();
          const ids = new Set(selected.map((o) => o.id));
          drag.current = {
            proxyInverse: proxy.matrixWorld.clone().invert(),
            startPos: proxy.position.clone(),
            items: selected.map((o) => ({ id: o.id, matrix: objectMatrix(o) })),
            snap: {
              startBox: boxOf(selected),
              others: visible.filter((o) => !ids.has(o.id) && !isHelper(o.type)).map(objectBox),
            },
          };
        }}
        onMouseUp={() => {
          lastGizmoInteraction = performance.now();
          drag.current = null;
        }}
        onObjectChange={() => {
          const d = drag.current;
          if (!d) return;
          // `axis` (aksen musa holder i, f.eks. "X" eller "XZ") er privat i typene, men offentlig i three.
          const axis = (controls.current as unknown as { axis: string | null } | null)?.axis;
          if (mode === "translate" && objectSnap && axis) {
            // Snap-avstanden vokser med kameraavstanden, så den føles lik uansett zoom.
            const threshold = THREE.MathUtils.clamp(camera.position.distanceTo(proxy.position) * 0.012, 0.02, 0.5);
            const moved = proxy.position.clone().sub(d.startPos);
            proxy.position.add(snapOffset(d.snap, moved, axis, threshold));
          }
          proxy.updateMatrixWorld();
          const delta = proxy.matrixWorld.clone().multiply(d.proxyInverse);
          updateObjectsLive(d.items.map((it) => ({ id: it.id, ...decompose(delta.clone().multiply(it.matrix)) })));
        }}
      />
    </>
  );
}

function useSelectHandler(id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (gizmoRecentlyUsed()) return;
    const state = useEditor.getState();
    if (state.tool === "note") {
      // Pinneverktøyet: fest en kommentar der det ble klikket på objektet.
      placeNote(e.point.clone(), state.objects.find((o) => o.id === id));
      return;
    }
    const multi = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
    useEditor.getState().select(id, multi ? "toggle" : "replace");
  };
}

function SolidMesh({ obj, selected, holes, accent }: { obj: SceneObject; selected: boolean; holes: SceneObject[]; accent: string }) {
  const onClick = useSelectHandler(obj.id);
  const transparent = obj.opacity < 1 || !!obj.hole;

  // Hull i samme mappe skjæres bort live (CSG). Uten hull brukes den delte geometrien.
  const holesKey = holes.map((h) => `${h.id}:${h.type}:${h.position}:${h.rotation}:${h.scale}`).join("|");
  const geometry = useMemo(
    () => {
      if (!holes.length) return geometryOf(obj);
      try {
        return cutGeometry(obj, holes);
      } catch (e) {
        // Importerte modeller er ikke alltid "vanntette" – da vises modellen uten hull.
        console.warn("Kunne ikke skjære hull i", obj.name, e);
        return geometryOf(obj);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obj.type, obj.meshId, obj.position, obj.rotation, obj.scale, holesKey],
  );
  const isCut = holes.length > 0;
  useEffect(() => () => void (isCut && geometry.dispose()), [geometry, isCut]);

  return (
    <mesh
      name={obj.name}
      userData={{ lunaId: obj.id }}
      geometry={geometry}
      position={obj.position}
      rotation={obj.rotation.map((d) => d * DEG) as Vec3}
      scale={obj.scale}
      castShadow={!obj.hole}
      receiveShadow={!obj.hole}
      onClick={onClick}
    >
      <meshStandardMaterial
        color={obj.color}
        metalness={obj.metalness}
        roughness={obj.roughness}
        transparent={transparent}
        opacity={obj.hole ? 0.28 : obj.opacity}
        depthWrite={!transparent}
        side={obj.type === "plane" || obj.hole || isCut ? THREE.DoubleSide : THREE.FrontSide}
      />
      {/* drei 10 har byttet om grenene i shaderen: uten `screenspace` er tykkelsen i piksler. */}
      {selected && <Outlines thickness={3} color={accent} />}
      {obj.hole && !selected && <Outlines thickness={1.5} color="#ff6b6b" />}
    </mesh>
  );
}

function LightObject({ obj, selected, accent }: { obj: SceneObject; selected: boolean; accent: string }) {
  const onClick = useSelectHandler(obj.id);
  const [target] = useState(() => new THREE.Object3D());
  return (
    <group position={obj.position} rotation={obj.rotation.map((d) => d * DEG) as Vec3}>
      {/* Markøren som kan klikkes på – kaster ikke skygge selv. */}
      <mesh name={obj.name} userData={{ lunaId: obj.id }} geometry={getGeometry(obj.type)} scale={obj.scale} onClick={onClick}>
        <meshBasicMaterial color={obj.color} toneMapped={false} />
        {selected && <Outlines thickness={3} color={accent} />}
      </mesh>
      {obj.type === "pointLight" ? (
        <pointLight color={obj.color} intensity={obj.intensity ?? 20} decay={2} castShadow shadow-mapSize={[512, 512]} shadow-bias={-0.002} />
      ) : (
        <>
          <primitive object={target} position={[0, -1, 0]} />
          <spotLight
            color={obj.color}
            intensity={obj.intensity ?? 60}
            angle={35 * DEG}
            penumbra={0.35}
            decay={2}
            target={target}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0005}
          />
        </>
      )}
    </group>
  );
}

/** Minste størrelse på en node-markør, i forhold til kameraavstanden (så den synes også på store stasjoner). */
const NODE_MIN_SCREEN = 0.08;

/** Markør-node: pil langs +Z (forover). Navnet vises når den er valgt – spillet finner noden på navnet. */
function NodeMarker({ obj, selected, accent }: { obj: SceneObject; selected: boolean; accent: string }) {
  const onClick = useSelectHandler(obj.id);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    const k = Math.max(1, (camera.position.distanceTo(m.getWorldPosition(new THREE.Vector3())) * NODE_MIN_SCREEN) / obj.scale[1]);
    m.scale.set(obj.scale[0] * k, obj.scale[1] * k, obj.scale[2] * k);
  });
  return (
    <group position={obj.position} rotation={obj.rotation.map((d) => d * DEG) as Vec3}>
      <mesh ref={mesh} name={obj.name} userData={{ lunaId: obj.id }} geometry={getGeometry(obj.type)} onClick={onClick}>
        <meshBasicMaterial color={obj.color} toneMapped={false} />
        {selected && <Outlines thickness={3} color={accent} />}
      </mesh>
      {selected && (
        <Html center className="node-label" pointerEvents="none">
          {obj.name}
        </Html>
      )}
    </group>
  );
}

/**
 * Nær- og fjernplanet følger avstanden til det kameraet ser på, så både små ting og
 * stasjoner på flere kilometer vises uten å bli klippet eller flimre.
 */
function CameraRange() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  useFrame(() => {
    const dist = controls ? camera.position.distanceTo(controls.target) : 10;
    const near = THREE.MathUtils.clamp(dist / 2000, 0.02, 5);
    const far = Math.max(1000, dist * 60);
    if (Math.abs(camera.near - near) / near > 0.2 || Math.abs(camera.far - far) / far > 0.2) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function ThreeBridge() {
  const get = useThree((s) => s.get);
  useEffect(() => setThreeGetter(get), [get]);
  return null;
}

function Scene({ accent }: { accent: string }) {
  const visible = useVisibleObjects();
  // Nytt detaljnivå gir nye geometrier – nøkkelen tvinger formene (og hullene) til å bygges på nytt.
  const detail = useUi((s) => s.geometryDetail);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Hull per mappe; et hull skjærer i de andre objektene i samme mappe.
  const holesByFolder = useMemo(() => {
    const map = new Map<string | null, SceneObject[]>();
    for (const o of visible) if (o.hole && !isHelper(o.type)) map.set(o.folderId, [...(map.get(o.folderId) ?? []), o]);
    return map;
  }, [visible]);

  return (
    <>
      {visible.map((o) =>
        isNode(o.type) ? (
          <NodeMarker key={`${o.id}:${detail}`} obj={o} selected={selected.has(o.id)} accent={accent} />
        ) : isLight(o.type) ? (
          <LightObject key={`${o.id}:${detail}`} obj={o} selected={selected.has(o.id)} accent={accent} />
        ) : (
          <SolidMesh
            key={`${o.id}:${detail}`}
            obj={o}
            selected={selected.has(o.id)}
            accent={accent}
            holes={o.hole ? [] : overlappingHoles(o, holesByFolder.get(o.folderId) ?? [])}
          />
        ),
      )}
      <SelectionGizmo visible={visible} />
    </>
  );
}

/** Rutenett og utvalgsfarge avledet fra temaet (bakgrunnen er gjennomsiktig, så temaets gradient synes). */
function useThemeColors() {
  const theme = useUi((s) => s.theme);
  return useMemo(() => {
    void theme;
    const c = themeColors();
    const bg = new THREE.Color(c.bgPage);
    const mix = (to: string, t: number) => `#${bg.clone().lerp(new THREE.Color(to), t).getHexString()}`;
    return { accent: c.accent, gridCell: mix(c.text, 0.14), gridSection: mix(c.accent, 0.45) };
  }, [theme]);
}

export function Viewport() {
  const select = useEditor((s) => s.select);
  const placingNote = useEditor((s) => s.tool === "note");
  const colors = useThemeColors();
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [6, 5, 8], fov: 50, near: 0.05, far: 1000 }}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      style={placingNote ? { cursor: "crosshair" } : undefined}
      onPointerMissed={(e) => {
        if (e.button !== 0 || gizmoRecentlyUsed() || e.ctrlKey || e.shiftKey) return;
        select(null);
        const s = useEditor.getState();
        if (s.activeNoteId && s.editingNoteId !== s.activeNoteId) s.openNote(null);
      }}
    >
      <ThreeBridge />
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
        <primitive object={groundShadowMaterial} attach="material" />
      </mesh>
      <Grid
        position={[0, -0.001, 0]}
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor={colors.gridCell}
        sectionColor={colors.gridSection}
        fadeDistance={60}
        fadeStrength={1.5}
      />
      <Scene accent={colors.accent} />
      <NotePins />
      <NoteGroundCatcher />
      {/* Høyre mus er fri flyging (FlyControls), så panorering ligger på midtknappen. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
      />
      <FlyControls />
      <CameraRange />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={["#f7768e", "#9ece6a", "#7aa2f7"]} labelColor="#1d2030" />
      </GizmoHelper>
    </Canvas>
  );
}
