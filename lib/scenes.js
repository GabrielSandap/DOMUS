const fs = require("node:fs");
const path = require("node:path");

const scenesPath = path.join(process.env.DOMUS_ROOT || process.cwd(), "domus-scenes.json");
const defaultTransitionMs = 3000;
const minTransitionMs = 0;
const maxTransitionMs = 10000;

function emptyStore() {
  return { scenes: [] };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readScenesStore() {
  if (!fs.existsSync(scenesPath)) return emptyStore();
  const raw = fs.readFileSync(scenesPath, "utf8").trim();
  if (!raw) return emptyStore();
  const store = JSON.parse(raw);
  return { scenes: Array.isArray(store.scenes) ? store.scenes : [] };
}

function writeScenesStore(store) {
  fs.writeFileSync(scenesPath, `${JSON.stringify(store, null, 2)}\n`);
}

function normalizeHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function normalizeTransitionMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return defaultTransitionMs;
  return Math.min(maxTransitionMs, Math.max(minTransitionMs, Math.round(number)));
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
    String(Math.round(hue)),
    String(Math.round(max === 0 ? 0 : (delta / max) * 100)),
    String(Math.max(1, Math.round(max * 100))),
  ];
}

function normalizeSceneDevice(device) {
  const colorTemp = device.color_temp || null;
  return {
    ip: String(device.ip),
    alias: device.alias || "",
    is_on: Boolean(device.is_on),
    brightness: device.brightness ?? null,
    color_temp: colorTemp,
    hex: colorTemp ? null : normalizeHex(device.hex) || hsvToHex(device.hsv) || null,
  };
}

function createSceneFromDevices(name, devices, options = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("Nom d'ambiance manquant.");
  }

  const scene = {
    id: slugify(cleanName) || `scene-${Date.now()}`,
    name: cleanName,
    transitionMs: normalizeTransitionMs(options.transitionMs),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    devices: devices
      .filter((device) => device?.ip && device.controllable !== false)
      .map(normalizeSceneDevice),
  };

  if (!scene.devices.length) {
    throw new Error("Aucune ampoule pilotable a enregistrer.");
  }

  return scene;
}

function saveScene(scene) {
  const store = readScenesStore();
  const existingIndex = store.scenes.findIndex(
    (item) => item.id === scene.id || item.name.toLowerCase() === scene.name.toLowerCase()
  );
  const nextScene = {
    ...scene,
    id: existingIndex >= 0 ? store.scenes[existingIndex].id : scene.id,
    transitionMs: normalizeTransitionMs(scene.transitionMs),
    createdAt: existingIndex >= 0 ? store.scenes[existingIndex].createdAt : scene.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    store.scenes[existingIndex] = nextScene;
  } else {
    store.scenes.push(nextScene);
  }

  writeScenesStore(store);
  return nextScene;
}

function findScene(nameOrId) {
  const needle = String(nameOrId || "").trim().toLowerCase();
  if (!needle) return null;
  const store = readScenesStore();
  return store.scenes.find(
    (scene) => scene.id.toLowerCase() === needle || scene.name.toLowerCase() === needle
  ) || null;
}

function updateSceneTransition(nameOrId, transitionMs) {
  const store = readScenesStore();
  const sceneIndex = store.scenes.findIndex((scene) => {
    const needle = String(nameOrId || "").trim().toLowerCase();
    return scene.id.toLowerCase() === needle || scene.name.toLowerCase() === needle;
  });
  if (sceneIndex < 0) return null;
  store.scenes[sceneIndex] = {
    ...store.scenes[sceneIndex],
    transitionMs: normalizeTransitionMs(transitionMs),
    updatedAt: new Date().toISOString(),
  };
  writeScenesStore(store);
  return store.scenes[sceneIndex];
}

function updateScene(nameOrId, patch = {}) {
  const store = readScenesStore();
  const needle = String(nameOrId || "").trim().toLowerCase();
  const sceneIndex = store.scenes.findIndex(
    (scene) => scene.id.toLowerCase() === needle || scene.name.toLowerCase() === needle
  );
  if (sceneIndex < 0) return null;

  const current = store.scenes[sceneIndex];
  const cleanName = String(patch.name ?? current.name).trim();
  if (!cleanName) throw new Error("Nom d'ambiance manquant.");

  const nameTaken = store.scenes.some(
    (scene, index) => index !== sceneIndex && scene.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (nameTaken) throw new Error("Une ambiance porte deja ce nom.");

  const nextDevices = Array.isArray(patch.devices)
    ? patch.devices
        .filter((device) => device?.ip)
        .map(normalizeSceneDevice)
    : current.devices || [];

  if (!nextDevices.length) {
    throw new Error("Aucune ampoule a enregistrer.");
  }

  store.scenes[sceneIndex] = {
    ...current,
    name: cleanName,
    transitionMs: normalizeTransitionMs(patch.transitionMs ?? current.transitionMs),
    devices: nextDevices,
    updatedAt: new Date().toISOString(),
  };
  writeScenesStore(store);
  return store.scenes[sceneIndex];
}

function deleteScene(nameOrId) {
  const store = readScenesStore();
  const scene = findScene(nameOrId);
  if (!scene) return null;
  store.scenes = store.scenes.filter((item) => item.id !== scene.id);
  writeScenesStore(store);
  return scene;
}

function sceneCommands(scene) {
  const commands = [];
  for (const device of scene.devices || []) {
    if (!device.ip) continue;
    if (!device.is_on) {
      commands.push({ ip: device.ip, action: "off", values: [] });
      continue;
    }

    if (device.hex) {
      const hsv = hexToHsv(device.hex);
      if (hsv) {
        commands.push({ ip: device.ip, action: "color", values: hsv });
        continue;
      }
    }

    if (device.color_temp) {
      const values = [String(device.color_temp)];
      if (device.brightness != null) values.push(String(device.brightness));
      commands.push({ ip: device.ip, action: "temp", values });
      continue;
    }

    if (device.brightness != null) {
      commands.push({ ip: device.ip, action: "brightness", values: [String(device.brightness)] });
    } else {
      commands.push({ ip: device.ip, action: "on", values: [] });
    }
  }
  return commands;
}

module.exports = {
  createSceneFromDevices,
  defaultTransitionMs,
  deleteScene,
  findScene,
  hexToHsv,
  hsvToHex,
  normalizeTransitionMs,
  readScenesStore,
  saveScene,
  sceneCommands,
  scenesPath,
  updateScene,
  updateSceneTransition,
};
