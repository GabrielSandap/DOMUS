"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Lightbulb,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  X,
  Trash2,
} from "lucide-react";

const defaultTransitionMs = 3000;

function sortDevices(devices) {
  return [...devices].sort((a, b) => {
    if (a.controllable !== b.controllable) return a.controllable ? -1 : 1;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });
}

function transitionLabel(ms) {
  const seconds = Number(ms || defaultTransitionMs) / 1000;
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

function normalizeHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function sanitizeHexDraft(value) {
  const raw = String(value || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
  return `#${raw.toUpperCase()}`;
}

export default function AmbiencesPage() {
  const [devices, setDevices] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [sceneName, setSceneName] = useState("");
  const [transitionMs, setTransitionMs] = useState(defaultTransitionMs);
  const [loading, setLoading] = useState(true);
  const [sceneBusy, setSceneBusy] = useState("");
  const [error, setError] = useState("");
  const [editingSceneId, setEditingSceneId] = useState("");
  const [editDraft, setEditDraft] = useState(null);
  const transitionTimers = useRef({});

  const sortedDevices = useMemo(() => sortDevices(devices), [devices]);
  const onlineDevices = devices.filter((device) => device.controllable);
  const scanningDevices = loading && !devices.length;
  const editingScene = scenes.find((scene) => scene.id === editingSceneId) || null;

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [lightsResponse, scenesResponse] = await Promise.all([
        fetch("/api/lights?fast=1&cache=1", { cache: "no-store" }),
        fetch("/api/scenes", { cache: "no-store" }),
      ]);
      const [lightsData, scenesData] = await Promise.all([
        lightsResponse.json(),
        scenesResponse.json(),
      ]);
      if (!lightsResponse.ok) throw new Error(lightsData.error || "Detection impossible");
      if (!scenesResponse.ok) throw new Error(scenesData.error || "Ambiances impossibles a charger");
      setDevices(lightsData.devices || []);
      setScenes(scenesData.scenes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshScenes() {
    const response = await fetch("/api/scenes", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ambiances impossibles a charger");
    setScenes(data.scenes || []);
  }

  async function saveCurrentScene() {
    const name = sceneName.trim();
    if (!name) {
      setError("Nom d'ambiance manquant");
      return;
    }
    setSceneBusy("save");
    setError("");
    try {
      const response = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          transitionMs,
          devices: onlineDevices,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sauvegarde impossible");
      setSceneName("");
      await refreshScenes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSceneBusy("");
    }
  }

  async function applyScene(scene) {
    setSceneBusy(scene.id);
    setError("");
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ambiance impossible a lancer");
      const updatedByIp = new Map((data.devices || []).map((item) => [item.ip, item]));
      if (updatedByIp.size) {
        setDevices((current) =>
          current.map((item) => updatedByIp.get(item.ip) || item)
        );
      }
      if (data.errors?.length) setError(data.errors.join("\n"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSceneBusy("");
    }
  }

  async function removeScene(scene) {
    setSceneBusy(scene.id);
    setError("");
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Suppression impossible");
      setScenes(data.scenes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSceneBusy("");
    }
  }

  function openEditor(scene) {
    setEditingSceneId(scene.id);
    setEditDraft({
      name: scene.name,
      transitionMs: scene.transitionMs ?? defaultTransitionMs,
      devices: (scene.devices || []).map((device) => ({
        ip: device.ip,
        alias: device.alias || device.ip,
        is_on: device.is_on !== false,
        brightness: device.brightness ?? 60,
        color_temp: device.color_temp ?? null,
        hex: normalizeHex(device.hex) || "#FFD08A",
      })),
    });
  }

  function closeEditor() {
    setEditingSceneId("");
    setEditDraft(null);
  }

  function patchEditDevice(ip, patch) {
    setEditDraft((current) => ({
      ...current,
      devices: current.devices.map((device) =>
        device.ip === ip ? { ...device, ...patch } : device
      ),
    }));
  }

  async function saveEditedScene(scene) {
    if (!editDraft?.name?.trim()) {
      setError("Nom d'ambiance manquant");
      return;
    }
    setSceneBusy(`edit:${scene.id}`);
    setError("");
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Modification impossible");
      setScenes(data.scenes || []);
      closeEditor();
    } catch (err) {
      setError(err.message);
    } finally {
      setSceneBusy("");
    }
  }

  function patchSceneTransition(scene, nextTransitionMs) {
    setScenes((current) =>
      current.map((item) =>
        item.id === scene.id ? { ...item, transitionMs: nextTransitionMs } : item
      )
    );

    if (transitionTimers.current[scene.id]) {
      clearTimeout(transitionTimers.current[scene.id]);
    }

    transitionTimers.current[scene.id] = setTimeout(async () => {
      delete transitionTimers.current[scene.id];
      try {
        const response = await fetch(`/api/scenes/${scene.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transitionMs: nextTransitionMs }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Transition impossible a enregistrer");
        setScenes(data.scenes || []);
      } catch (err) {
        setError(err.message);
      }
    }, 450);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => () => {
    for (const timer of Object.values(transitionTimers.current)) {
      clearTimeout(timer);
    }
  }, []);

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">DOMUS</p>
          <h1>Ambiances</h1>
        </div>
        <div className="topActions">
          <Link className="navButton" href="/">
            <ArrowLeft size={17} />
            Ampoules
          </Link>
          <button className="iconButton" onClick={refresh} disabled={loading} title="Actualiser">
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </section>

      <section className="summary ambienceSummary">
        <div className="metric">
          <Lightbulb size={18} />
          <span>{scanningDevices ? <Loader2 className="spin" size={22} /> : onlineDevices.length}</span>
          <small>{scanningDevices ? "scan ampoules" : "ampoules actives"}</small>
        </div>
        <div className="metric">
          <Activity size={18} />
          <span>{scenes.length}</span>
          <small>ambiances</small>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="scenePagePanel">
        <div className="sceneComposer">
          <h2>Sauvegarder l'etat actuel</h2>
          <div className="sceneSave">
            <input
              value={sceneName}
              onChange={(event) => setSceneName(event.target.value)}
              placeholder="Nom de l'ambiance"
            />
            <button onClick={saveCurrentScene} disabled={sceneBusy === "save" || scanningDevices || !onlineDevices.length}>
              {sceneBusy === "save" ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              Sauver
            </button>
          </div>
          <div className="transitionControl">
            <label>
              <span>Transition</span>
              <b>{transitionLabel(transitionMs)}</b>
            </label>
            <input
              type="range"
              min="0"
              max="10000"
              step="500"
              value={transitionMs}
              onChange={(event) => setTransitionMs(Number(event.target.value))}
            />
          </div>
          <small>
            {scanningDevices
              ? "Connexion aux ampoules..."
              : `${onlineDevices.length} ampoule${onlineDevices.length > 1 ? "s" : ""} seront incluses.`}
          </small>
        </div>
      </section>

      <section className="deviceStrip">
        {sortedDevices.map((device) => (
          <div className="devicePill" key={device.ip}>
            <span className={device.is_on ? "dot on" : "dot"} />
            <strong>{device.alias || device.ip}</strong>
            <small>{device.controllable ? "pilotable" : "indispo"}</small>
          </div>
        ))}
      </section>

      <section className="sceneLibraryPanel">
        <div className="sectionHeader">
          <div>
            <h2>Ambiances sauvegardees</h2>
            <small>{scenes.length} ambiance{scenes.length > 1 ? "s" : ""} disponible{scenes.length > 1 ? "s" : ""}</small>
          </div>
        </div>

        <div className="sceneGrid">
          {scenes.length ? scenes.map((scene) => (
            <article className="sceneCard" key={scene.id}>
              <div>
                <strong>{scene.name}</strong>
                <small>
                  {scene.devices?.length || 0} ampoule{scene.devices?.length > 1 ? "s" : ""} · {transitionLabel(scene.transitionMs)}
                </small>
              </div>
              <div className="sceneTiming">
                <label>
                  <span>Vitesse</span>
                  <b>{transitionLabel(scene.transitionMs)}</b>
                </label>
                <input
                  type="range"
                  min="0"
                  max="10000"
                  step="500"
                  value={scene.transitionMs ?? defaultTransitionMs}
                  onChange={(event) => patchSceneTransition(scene, Number(event.target.value))}
                  disabled={Boolean(sceneBusy)}
                />
              </div>
              <div className="sceneCardActions">
                <button className="primary" onClick={() => applyScene(scene)} disabled={Boolean(sceneBusy)}>
                  {sceneBusy === scene.id ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                  Lancer
                </button>
                <button className="iconButton compact" onClick={() => openEditor(scene)} disabled={Boolean(sceneBusy)} title="Modifier">
                  <Pencil size={16} />
                </button>
                <button className="iconButton compact" onClick={() => removeScene(scene)} disabled={Boolean(sceneBusy)} title="Supprimer">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          )) : (
            <div className="sceneEmptyPanel">Aucune ambiance sauvegardee</div>
          )}
        </div>
      </section>

      {editingScene && editDraft ? (
        <section className="sceneEditorPanel">
          <div className="sectionHeader">
            <div>
              <h2>Modifier {editingScene.name}</h2>
              <small>{editDraft.devices.length} ampoule{editDraft.devices.length > 1 ? "s" : ""} dans cette ambiance</small>
            </div>
          </div>

          <div className="sceneEditor">
            <input
              value={editDraft.name}
              onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
              aria-label="Nom de l'ambiance"
            />
            <div className="sceneTiming">
              <label>
                <span>Transition</span>
                <b>{transitionLabel(editDraft.transitionMs)}</b>
              </label>
              <input
                type="range"
                min="0"
                max="10000"
                step="500"
                value={editDraft.transitionMs}
                onChange={(event) =>
                  setEditDraft((current) => ({ ...current, transitionMs: Number(event.target.value) }))
                }
              />
            </div>
            <div className="sceneDeviceEditorList">
              {editDraft.devices.map((device) => {
                const normalizedHex = normalizeHex(device.hex);
                return (
                  <div className="sceneDeviceEditor" key={device.ip}>
                    <label className="deviceToggle">
                      <input
                        type="checkbox"
                        checked={device.is_on}
                        onChange={(event) => patchEditDevice(device.ip, { is_on: event.target.checked })}
                      />
                      <span>{device.alias}</span>
                    </label>
                    <div className="miniHexControl">
                      <input
                        type="color"
                        value={normalizedHex || "#FFD08A"}
                        onChange={(event) => patchEditDevice(device.ip, {
                          hex: event.target.value.toUpperCase(),
                          color_temp: null,
                        })}
                        disabled={!device.is_on}
                      />
                      <input
                        type="text"
                        className={normalizedHex ? "" : "invalid"}
                        value={device.hex}
                        maxLength={7}
                        onChange={(event) => {
                          const nextHex = sanitizeHexDraft(event.target.value);
                          patchEditDevice(device.ip, { hex: nextHex, color_temp: null });
                        }}
                        disabled={!device.is_on}
                      />
                    </div>
                    <div className="sceneTiming">
                      <label>
                        <span>Intensite</span>
                        <b>{device.brightness}%</b>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={device.brightness}
                        onChange={(event) => patchEditDevice(device.ip, { brightness: Number(event.target.value) })}
                        disabled={!device.is_on}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="editorActions">
              <button onClick={closeEditor} disabled={Boolean(sceneBusy)}>
                <X size={15} />
                Annuler
              </button>
              <button className="primary" onClick={() => saveEditedScene(editingScene)} disabled={sceneBusy === `edit:${editingScene.id}`}>
                {sceneBusy === `edit:${editingScene.id}` ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                Enregistrer
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
