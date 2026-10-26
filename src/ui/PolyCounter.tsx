// Trekantteller øverst til høyre: hvor tung scenen er (det som eksporteres), og hvor mye av det som er valgt.

import { useMemo } from "react";
import { useEditor } from "../store";
import { hiddenFolderIds } from "../folders";
import { isHelper, type SceneObject } from "../types";
import { geometryOf } from "../viewport/geometries";
import { useUi } from "./uiStore";

const triangles = (o: SceneObject) => {
  const geo = geometryOf(o);
  return (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
};

const format = (n: number) => Math.round(n).toLocaleString("nb-NO");

export function PolyCounter() {
  const objects = useEditor((s) => s.objects);
  const folders = useEditor((s) => s.folders);
  const selectedIds = useEditor((s) => s.selectedIds);
  // Antallet avhenger av detaljnivået (glatt/lavpoly).
  const detail = useUi((s) => s.geometryDetail);

  const { total, selected } = useMemo(() => {
    const hidden = hiddenFolderIds(folders);
    const chosen = new Set(selectedIds);
    let total = 0;
    let selected = 0;
    for (const o of objects) {
      // Som eksporten: synlige faste former – ikke hull, lys eller noder.
      if (isHelper(o.type) || o.hole || !o.visible || (o.folderId && hidden.has(o.folderId))) continue;
      const n = triangles(o);
      total += n;
      if (chosen.has(o.id)) selected += n;
    }
    return { total, selected };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, folders, selectedIds, detail]);

  return (
    <div
      className="poly-pill"
      title={`Trekanter i synlige objekter (det som eksporteres)${selectedIds.length ? `\nValgt: ${format(selected)}` : ""}\nDetaljnivå: ${
        detail === "smooth" ? "glatt" : "lavpoly"
      } (Innstillinger → Former)`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3 22 20H2z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      {selectedIds.length > 0 && (
        <>
          <span className="poly-selected">{format(selected)}</span>
          <span className="poly-sep">/</span>
        </>
      )}
      <span>{format(total)}</span>
    </div>
  );
}
