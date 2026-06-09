"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Gauge,
  KeyRound,
  Lightbulb,
  Loader2,
  Palette,
  Power,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  ThermometerSun,
  Wifi,
  WifiOff,
} from "lucide-react";

const initialPlaceholders = ["scan-1", "scan-2", "scan-3", "scan-4"];
const defaultWhiteTemp = 4000;

function normalizeHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function sanitizeHexDraft(value) {
  const raw = String(value || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
  return `#${raw.toUpperCase()}`;
}

function hsvToHex(hsv) {
  if (!hsv) return null;
  const hue = Number(hsv.hue ?? 0);
  const saturation = Number(hsv.saturation ?? 0) / 100;
  const value = Number(hsv.value ?? 0) / 100;
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [r, g, b] =
    hue < 60 ? [chroma, secondary, 0] :
    hue < 120 ? [secondary, chroma, 0] :
    hue < 180 ? [0, chroma, secondary] :
    hue < 240 ? [0, secondary, chroma] :
    hue < 300 ? [secondary, 0, chroma] :
    [chroma, 0, secondary];

  return `#${[r, g, b]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function hexToHsv(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const red = parseInt(normalized.slice(1, 3), 16) / 255;
  const green = parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta && max === red) hue = 60 * (((green - blue) / delta) % 6);
  if (delta && max === green) hue = 60 * ((blue - red) / delta + 2);
  if (delta && max === blue) hue = 60 * ((red - green) / delta + 4);
  if (hue < 0) hue += 360;

  return [
    Math.round(hue),
    Math.round(max === 0 ? 0 : (delta / max) * 100),
    Math.max(1, Math.round(max * 100)),
  ];
}

function statusLabel(device) {
  if (device.status === "online") return "Connectee";
  if (device.status === "loading") return "Scan";
  if (device.status === "unsupported_tpap") return "TPAP";
  if (device.status === "auth_failed") return "Auth";
  return "Indispo";
}

function sortDevices(devices) {
  return [...devices].sort((a, b) => {
    if (a.controllable !== b.controllable) return a.controllable ? -1 : 1;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });
}

function loadingDevices() {
  return initialPlaceholders.map((ip) => ({
    ip,
    alias: "Recherche Tapo",
    model: "Recherche...",
    is_on: null,
    controllable: false,
    status: "loading",
    features: {},
    brightness: null,
    color_temp: null,
    hsv: null,
    error: "Detection en cours",
  }));
}

export default function Home() {
  const [setup, setSetup] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupDraft, setSetupDraft] = useState({
    email: "",
    password: "",
    knownIpsText: "",
    knownAliasesText: "",
  });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const [devices, setDevices] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");
  const syncTimers = useRef({});

  const displayedDevices = devices.length ? devices : loading ? loadingDevices() : [];
  const sortedDevices = useMemo(() => sortDevices(displayedDevices), [displayedDevices]);
  const onlineCount = devices.filter((device) => device.controllable).length;
  const needsSetup = setup && !setup.configured;

  async function refresh({ preferCache = true } = {}) {
    setLoading(true);
    setError("");
    try {
      const cacheQuery = preferCache ? "&cache=1" : "";
      const response = await fetch(`/api/lights?fast=1${cacheQuery}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Detection impossible");
      setDevices(data.devices || []);
      setDrafts((current) => {
        const next = { ...current };
        for (const device of data.devices || []) {
          next[device.ip] = {
            ...current[device.ip],
            brightness: device.brightness ?? current[device.ip]?.brightness ?? 50,
            temp: device.color_temp || current[device.ip]?.temp || defaultWhiteTemp,
            hex: current[device.ip]?.hex ?? hsvToHex(device.hsv) ?? "#4277D9",
          };
        }
        return next;
      });
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadSetup() {
    const response = await fetch("/api/setup", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Configuration impossible");
    setSetup(data);
    setSetupDraft({
      email: data.email || "",
      password: "",
      knownIpsText: (data.knownIps || []).join(","),
      knownAliasesText: data.knownAliases || "",
    });
    setSetupOpen(!data.configured);
    return data;
  }

  async function saveSetup({ scan = false } = {}) {
    setSetupBusy(true);
    setSetupMessage("");
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setupDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Configuration impossible");
      setSetup(data);
      setSetupMessage(scan ? "Configuration enregistree. Scan du reseau..." : "Configuration enregistree.");

      if (scan) {
        const scanData = await refresh({ preferCache: false });
        const foundDevices = (scanData?.devices || []).filter((device) => device.controllable);
        if (foundDevices.length) {
          const saveResponse = await fetch("/api/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: setupDraft.email,
              password: setupDraft.password,
              devices: foundDevices,
            }),
          });
          const saved = await saveResponse.json();
          if (saveResponse.ok) setSetup(saved);
          setSetupMessage(`${foundDevices.length} appareil${foundDevices.length > 1 ? "s" : ""} Tapo memorise${foundDevices.length > 1 ? "s" : ""}.`);
          setSetupOpen(false);
        } else {
          setSetupMessage("Aucun appareil pilotable trouve. Verifie le Wi-Fi et les identifiants.");
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSetupBusy(false);
    }
  }

  function patchDraft(ip, patch) {
    setDrafts((current) => ({
      ...current,
      [ip]: {
        ...current[ip],
        ...patch,
      },
    }));
  }

  function predictDevice(device, action, values = []) {
    const next = { ...device };
    if (action === "on") next.is_on = true;
    if (action === "off") next.is_on = false;
    if (action === "toggle") next.is_on = !device.is_on;
    if (action === "brightness") {
      next.is_on = true;
      next.brightness = Number(values[0]);
    }
    if (action === "temp") {
      next.is_on = true;
      next.color_temp = Number(values[0]);
      next.hsv = null;
      if (values[1] != null) next.brightness = Number(values[1]);
    }
    if (action === "color") {
      next.is_on = true;
      next.color_temp = 0;
      next.hsv = {
        hue: Number(values[0]),
        saturation: Number(values[1]),
        value: Number(values[2] ?? device.brightness ?? 100),
      };
      next.brightness = Number(values[2] ?? device.brightness ?? 100);
    }
    return next;
  }

  function applyOptimistic(targetIps, action, values = []) {
    const targetSet = new Set(targetIps);
    setDevices((current) =>
      current.map((device) =>
        targetSet.has(device.ip) ? predictDevice(device, action, values) : device
      )
    );
  }

  function sendHexColor(device, hex) {
    const hsv = hexToHsv(hex);
    if (!hsv) {
      setError("Couleur HEX invalide");
      return;
    }
    clearScheduledSync(device.ip, "color");
    send(device, "color", hsv);
  }

  function clearScheduledSync(ip, action) {
    const key = `${ip}:${action}`;
    if (!syncTimers.current[key]) return;
    clearTimeout(syncTimers.current[key]);
    delete syncTimers.current[key];
  }

  function scheduleSend(device, action, values) {
    const key = `${device.ip}:${action}`;
    clearScheduledSync(device.ip, action);
    syncTimers.current[key] = setTimeout(() => {
      delete syncTimers.current[key];
      send(device, action, values);
    }, 550);
  }

  async function send(device, action, values = []) {
    setBusy((current) => ({ ...current, [device.ip]: true }));
    setError("");
    applyOptimistic([device.ip], action, values);
    try {
      const response = await fetch(`/api/lights/${device.ip}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Commande impossible");
      const updatedDevices = data.devices || [];
      if (updatedDevices.length) {
        const updatedByIp = new Map(updatedDevices.map((item) => [item.ip, item]));
        setDevices((current) =>
          current.map((item) => updatedByIp.get(item.ip) || item)
        );
      }
    } catch (err) {
      setError(err.message);
      refresh({ preferCache: false });
    } finally {
      setBusy((current) => ({ ...current, [device.ip]: false }));
    }
  }

  async function sendAll(action) {
    const targetDevices = devices.filter((device) => device.controllable);
    setBusy((current) => ({
      ...current,
      ...Object.fromEntries(targetDevices.map((device) => [device.ip, true])),
    }));
    setError("");
    applyOptimistic(targetDevices.map((device) => device.ip), action, []);
    try {
      const response = await fetch("/api/lights/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          values: [],
          targets: targetDevices.map((device) => device.ip),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Commande impossible");
      const updatedByIp = new Map((data.devices || []).map((item) => [item.ip, item]));
      setDevices((current) =>
        current.map((item) => updatedByIp.get(item.ip) || item)
      );
    } catch (err) {
      setError(err.message);
      refresh({ preferCache: false });
    } finally {
      setBusy((current) => ({
        ...current,
        ...Object.fromEntries(targetDevices.map((device) => [device.ip, false])),
      }));
    }
  }

  useEffect(() => {
    loadSetup()
      .then((data) => {
        if (data.configured) refresh();
        else setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => () => {
    for (const timer of Object.values(syncTimers.current)) {
      clearTimeout(timer);
    }
  }, []);

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">DOMUS</p>
        </div>
        <div className="topActions">
          <button className="navButton" onClick={() => setSetupOpen((value) => !value)} title="Configuration Tapo">
            <Settings size={17} />
            Setup
          </button>
          <Link className="navButton" href="/ambiences">
            <Sparkles size={17} />
            Ambiances
          </Link>
          <button className="iconButton" onClick={() => refresh({ preferCache: false })} disabled={loading} title="Actualiser">
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </section>

      {setupOpen || needsSetup ? (
        <section className="setupPanel">
          <div className="setupHeader">
            <div>
              <p className="eyebrow">Quick start</p>
              <h1>Connecter Tapo</h1>
            </div>
            <span className={`setupState ${setup?.configured ? "ready" : ""}`}>
              {setup?.configured ? <CheckCircle2 size={15} /> : <KeyRound size={15} />}
              {setup?.configured ? "Configure" : "A configurer"}
            </span>
          </div>

          <div className="setupSteps">
            <div className="setupStep">
              <Wifi size={18} />
              <strong>Meme Wi-Fi</strong>
              <small>Le Mac qui lance DOMUS doit etre sur le reseau local des appareils Tapo.</small>
            </div>
            <div className="setupStep">
              <KeyRound size={18} />
              <strong>Compte TP-Link</strong>
              <small>Utilise l email et le mot de passe TP-Link/Tapo, pas le mot de passe Wi-Fi.</small>
            </div>
            <div className="setupStep">
              <Search size={18} />
              <strong>Scan local</strong>
              <small>DOMUS memorise les IP trouvees pour accelerer les prochains lancements.</small>
            </div>
          </div>

          <div className="setupForm">
            <label>
              Email Tapo
              <input
                type="email"
                value={setupDraft.email}
                onChange={(event) => setSetupDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="nom@example.com"
              />
            </label>
            <label>
              Mot de passe Tapo
              <input
                type="password"
                value={setupDraft.password}
                onChange={(event) => setSetupDraft((current) => ({ ...current, password: event.target.value }))}
                placeholder={setup?.hasPassword ? "Deja enregistre" : "Mot de passe TP-Link"}
              />
            </label>
            <label className="wide">
              IP connues, optionnel
              <input
                value={setupDraft.knownIpsText}
                onChange={(event) => setSetupDraft((current) => ({ ...current, knownIpsText: event.target.value }))}
                placeholder="192.168.1.42,192.168.1.43"
              />
            </label>
            <div className="setupActions">
              <button onClick={() => saveSetup()} disabled={setupBusy}>
                {setupBusy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                Enregistrer
              </button>
              <button className="primary" onClick={() => saveSetup({ scan: true })} disabled={setupBusy}>
                {setupBusy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                Enregistrer et scanner
              </button>
            </div>
          </div>

          {setupMessage ? <p className="setupMessage">{setupMessage}</p> : null}
        </section>
      ) : null}

      <section className="summary">
        <div className="metric">
          <Lightbulb size={18} />
          <span>{devices.length || 0}</span>
          <small>detectees</small>
        </div>
        <div className="metric">
          <Activity size={18} />
          <span>{onlineCount}</span>
          <small>pilotables</small>
        </div>
        <div className="actions">
          <button onClick={() => sendAll("on")} disabled={!onlineCount}>
            Tout allumer
          </button>
          <button onClick={() => sendAll("off")} disabled={!onlineCount}>
            Tout eteindre
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="grid" aria-busy={loading}>
        {!sortedDevices.length ? (
          <div className="empty">
            <Search size={20} />
            <strong>{needsSetup ? "Configuration Tapo requise" : "Aucun appareil detecte"}</strong>
            <small>{needsSetup ? "Renseigne ton compte Tapo puis lance le scan." : "Lance un scan depuis Setup ou verifie le Wi-Fi local."}</small>
          </div>
        ) : null}

        {sortedDevices.map((device) => {
          const draft = drafts[device.ip] || {};
          const brightness = draft.brightness ?? device.brightness ?? 50;
          const whiteTemp = (draft.temp ?? device.color_temp) || defaultWhiteTemp;
          const colorHex = draft.hex ?? hsvToHex(device.hsv) ?? "#4277D9";
          const normalizedColorHex = normalizeHex(colorHex);
          const isBusy = Boolean(busy[device.ip]);

          return (
            <article
              className={`device ${device.controllable ? "online" : "locked"} ${device.status === "loading" ? "loadingCard" : ""}`}
              key={device.ip}
            >
              <header className="deviceHeader">
                <div>
                  <h2>{device.alias || `Ampoule ${device.ip.split(".").at(-1)}`}</h2>
                  <p>{device.model || device.ip}</p>
                </div>
                <span className="status">
                  {device.controllable ? <Activity size={14} /> : <WifiOff size={14} />}
                  {statusLabel(device)}
                </span>
              </header>

              {device.status === "loading" ? (
                <div className="lockedBody">
                  <Loader2 className="spin" size={18} />
                  <strong>Recherche en cours</strong>
                  <small>{device.ip}</small>
                </div>
              ) : device.controllable ? (
                <>
                  <div className="stateLine">
                    <span className={device.is_on ? "dot on" : "dot"} />
                    <strong>{device.is_on ? "Allumee" : "Eteinte"}</strong>
                    <small>{device.ip}</small>
                  </div>

                  <div className="buttonRow">
                    <button className="primary" onClick={() => send(device, "toggle")} disabled={isBusy}>
                      {isBusy ? <Loader2 className="spin" size={16} /> : <Power size={16} />}
                      Basculer
                    </button>
                    <button onClick={() => send(device, "on")} disabled={isBusy}>On</button>
                    <button onClick={() => send(device, "off")} disabled={isBusy}>Off</button>
                  </div>

                  {device.features?.brightness ? (
                    <div className="control">
                      <label>
                        <span><Gauge size={15} /> Luminosite</span>
                        <b>{brightness}%</b>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={brightness}
                        onChange={(event) => {
                          const nextBrightness = Number(event.target.value);
                          patchDraft(device.ip, { brightness: nextBrightness });
                          scheduleSend(device, "brightness", [nextBrightness]);
                        }}
                        disabled={isBusy}
                      />
                    </div>
                  ) : null}

                  {device.features?.color_temp ? (
                    <div className="tempControl">
                      <label>
                        <span><ThermometerSun size={15} /> Blanc</span>
                        <b>{whiteTemp}K</b>
                      </label>
                      <input
                        type="range"
                        min="2700"
                        max="6500"
                        step="100"
                        value={whiteTemp}
                        onChange={(event) => {
                          const nextTemp = Number(event.target.value);
                          patchDraft(device.ip, { temp: nextTemp });
                          scheduleSend(device, "temp", [nextTemp]);
                        }}
                        disabled={isBusy}
                      />
                    </div>
                  ) : null}

                  {device.features?.hsv ? (
                    <div className="presetGroup colors">
                      <span>Couleur</span>
                      <div className="hexControl">
                        <label title="Couleur HEX">
                          <Palette size={15} />
                          <input
                            type="color"
                            value={normalizedColorHex || "#4277D9"}
                            onChange={(event) => {
                              const nextHex = event.target.value.toUpperCase();
                              patchDraft(device.ip, { hex: nextHex });
                              scheduleSend(device, "color", hexToHsv(nextHex));
                            }}
                            disabled={isBusy}
                          />
                        </label>
                        <input
                          type="text"
                          className={normalizedColorHex ? "" : "invalid"}
                          value={colorHex}
                          maxLength={7}
                          onChange={(event) => {
                            const nextHex = sanitizeHexDraft(event.target.value);
                            patchDraft(device.ip, { hex: nextHex });
                            const nextHsv = hexToHsv(nextHex);
                            if (nextHsv) scheduleSend(device, "color", nextHsv);
                            else clearScheduledSync(device.ip, "color");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && normalizedColorHex) {
                              sendHexColor(device, normalizedColorHex);
                            }
                          }}
                          aria-label="Couleur HEX"
                          disabled={isBusy}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="lockedBody">
                  <WifiOff size={18} />
                  <strong>{device.error || "Non controlable"}</strong>
                  <small>{device.ip}</small>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
