// Innstillinger: utseende (temavelger som i LunaChat), import og «Om Luna 3D».

import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { THEMES, useUi } from "./uiStore";
import { Icon } from "./icons";

const CHANGELOG_URL = "https://github.com/andersstra-stack/Luna3deditor/blob/main/CHANGELOG.md";

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const theme = useUi((s) => s.theme);
  const keepOrigin = useUi((s) => s.importKeepOrigin);
  const detail = useUi((s) => s.geometryDetail);
  const { setTheme, setImportKeepOrigin, setGeometryDetail, closeSettings } = useUi.getState();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeSettings()}>
      <div className="modal" role="dialog" aria-label="Innstillinger">
        <header className="modal-header">
          <h2>Innstillinger</h2>
          <button className="icon-btn" title="Lukk (Esc)" onClick={closeSettings}>
            <Icon name="close" />
          </button>
        </header>

        <section>
          <h3 className="settings-h3">Utseende</h3>
          <p className="settings-sub">Samme temaer som LunaChat. Valget huskes til neste gang.</p>
          <div className="theme-grid">
            {THEMES.map((th) => {
              const isActive = theme === th.id;
              return (
                <button key={th.id} type="button" className={`theme-card ${isActive ? "active" : ""}`} onClick={() => setTheme(th.id)}>
                  <div className="theme-card-preview" style={{ background: th.swatch.bg }}>
                    <div className="theme-card-panel" style={{ background: th.swatch.panel, color: th.swatch.text }}>
                      <span className="theme-card-dot" style={{ background: th.swatch.accent }} />
                      <span>Aa</span>
                    </div>
                    {isActive && (
                      <div className="theme-card-check">
                        <Icon name="check" size={14} />
                      </div>
                    )}
                  </div>
                  <div className="theme-card-name">{th.label}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="settings-h3">Former</h3>
          <label className={`toggle-row ${detail === "lowpoly" ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={detail === "lowpoly"}
              onChange={() => setGeometryDetail(detail === "lowpoly" ? "smooth" : "lowpoly")}
            />
            <Icon name="shapes" size={16} />
            <span>
              Lavpoly
              <small>
                Færre segmenter på kuler, sylindre, kjegler og avrundede former – for spill. Gjelder visning, hull,
                «Slå sammen» og GLB-eksport. Importerte modeller endres ikke.
              </small>
            </span>
          </label>
        </section>

        <section>
          <h3 className="settings-h3">Import</h3>
          <label className={`toggle-row ${keepOrigin ? "on" : ""}`}>
            <input type="checkbox" checked={keepOrigin} onChange={() => setImportKeepOrigin(!keepOrigin)} />
            <Icon name="import" size={16} />
            <span>
              Behold filas origo
              <small>
                Modellens origo havner i scenens origo, så deler som hører sammen (f.eks. interiør og eksteriør fra Blender)
                passer uten justering. Av: modellen settes på bakken der kameraet ser.
              </small>
            </span>
          </label>
        </section>

        <section className="about">
          <h3 className="settings-h3">Om Luna 3D</h3>
          <p>
            Versjon <b>{__APP_VERSION__}</b>
          </p>
          <button className="link-btn" onClick={() => openUrl(CHANGELOG_URL).catch(() => {})}>
            Se endringsloggen
          </button>
        </section>
      </div>
    </div>
  );
}
