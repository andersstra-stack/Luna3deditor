import { useEffect } from "react";
import { useEditor } from "../store";
import { useUi } from "./uiStore";
import { UpdateButton } from "./UpdateButton";

export function reportError(e: unknown) {
  useEditor.getState().setActivity(`Feil: ${e instanceof Error ? e.message : String(e)}`);
}

export function StatusBar() {
  const count = useEditor((s) => s.objects.length);
  const activity = useEditor((s) => s.activity);
  const filePath = useEditor((s) => s.filePath);
  const setActivity = useEditor((s) => s.setActivity);

  useEffect(() => {
    if (!activity) return;
    const t = setTimeout(() => setActivity(null), 5000);
    return () => clearTimeout(t);
  }, [activity, setActivity]);

  return (
    <footer className="statusbar">
      <span>
        {count} objekt{count === 1 ? "" : "er"}
      </span>
      <span className={`activity ${activity?.startsWith("Feil") ? "error" : ""}`}>{activity}</span>
      <span className="path" title={filePath ?? undefined}>
        {filePath ?? "Ulagret scene"}
      </span>
      <UpdateButton />
      <button className="version-btn" title="Om Luna 3D" onClick={() => useUi.getState().openSettings()}>
        v{__APP_VERSION__}
      </button>
    </footer>
  );
}
