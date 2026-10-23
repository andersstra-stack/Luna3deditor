import { useMemo } from "react";
import * as THREE from "three";
import { useEditor } from "../store";
import { boxOf } from "../bounds";

const fmt = (v: number) => v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Viser størrelse og plassering av utvalget nederst i 3D-visningen – oppdateres live mens man drar. */
export function SelectionInfo() {
  const objects = useEditor((s) => s.objects);
  const selectedIds = useEditor((s) => s.selectedIds);

  const info = useMemo(() => {
    const sel = objects.filter((o) => selectedIds.includes(o.id));
    if (!sel.length) return null;
    const box = boxOf(sel);
    const size = box.getSize(new THREE.Vector3());
    return {
      label: sel.length === 1 ? sel[0].name : `${sel.length} objekter`,
      size,
      bottom: box.min.y,
    };
  }, [objects, selectedIds]);

  if (!info) return null;
  return (
    <div className="selection-info">
      <b>{info.label}</b>
      <span className="dims">
        <span className="axis-x">{fmt(info.size.x)}</span> × <span className="axis-y">{fmt(info.size.y)}</span> ×{" "}
        <span className="axis-z">{fmt(info.size.z)}</span> m
      </span>
      <span className="dim-note">bunn {fmt(info.bottom)} m</span>
    </div>
  );
}
