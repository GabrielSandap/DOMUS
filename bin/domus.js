#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.env.DOMUS_ROOT = process.env.DOMUS_ROOT || root;

const {
  createSceneFromDevices,
  deleteScene,
  findScene,
  readScenesStore,
  saveScene,
  sceneCommands,
  updateSceneTransition,
} = require("../lib/scenes");

const python = process.env.TAPO_PYTHON_BIN || path.join(root, ".venv/bin/python");
const script = process.env.TAPO_SCRIPT || path.join(root, "tapo_lights.py");
const lockPath = path.join(root, ".tapo-api.lock");
const lockStaleMs = 60_000;
const lockPollMs = 150;

const commands = new Set([
  "list",
  "ls",
  "status",
  "on",
  "off",
  "toggle",
  "brightness",
  "dim",
  "temp",
  "white",
  "color",
  "scene",
  "scenes",
  "raw",
  "help",
]);

function usage(exitCode = 0) {
  const message = `
DOMUS CLI

Usage:
  domus list
  domus on [cible]
  domus off [cible]
  domus toggle <cible>
  domus brightness <cible> <1-100>
  domus temp <cible> <kelvin> [brightness]
  domus color <cible> <#RRGGBB>
  domus color <cible> <hue> <saturation> [value]
  domus scene list
  domus scene save <nom> [--transition <ms>]
  domus scene apply <nom> [--transition <ms>]
  domus scene transition <nom> <ms>
  domus scene delete <nom>
  domus raw <arguments tapo_lights.py>

Options:
  --json              Affiche la sortie JSON brute
  --timeout <secs>    Temps de scan, defaut 5

Exemples:
  domus list
  domus on all
  domus off Salon
  domus brightness Bureau 35
  domus color Chevet "#FF8800"
  domus scene save Soiree --transition 3000
  domus scene apply Soiree
`;
  console.log(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = { json: false, timeout: null };
  const args = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      options.json = true;
    } else if (value === "--timeout") {
      const timeout = argv[index + 1];
      if (!timeout || timeout.startsWith("--")) fail("--timeout attend une valeur.");
      options.timeout = timeout;
      index += 1;
    } else {
      args.push(value);
    }
  }

  const command = args[0] || "help";
  if (!commands.has(command)) fail(`Commande inconnue: ${command}`);
  return { command, args: args.slice(1), options };
}

function fail(message) {
  console.error(`Erreur: ${message}`);
  if (String(message).includes("No route to host")) {
    console.error(
      "Astuce macOS: autorise Terminal dans Reglages Systeme > Confidentialite et securite > Reseau local."
    );
  }
  console.error("Lance `domus help` pour voir les commandes.");
  process.exit(1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      return fd;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      try {
        const info = fs.statSync(lockPath);
        if (Date.now() - info.mtimeMs > lockStaleMs) {
          fs.rmSync(lockPath, { force: true });
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }

      sleep(lockPollMs);
    }
  }
}

function runTapo(args) {
  const result = tryRunTapo(args);
  if (result.ok) return result.output;
  fail(result.error);
}

function tryRunTapo(args) {
  const fd = acquireLock();
  let failure = null;
  try {
    const output = execFileSync(python, [script, ...args], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    }).trim();
    return { ok: true, output };
  } catch (error) {
    const stderr = String(error.stderr || "").trim();
    const stdout = String(error.stdout || "").trim();
    failure = stderr || stdout || error.message || "Commande impossible.";
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    fs.rmSync(lockPath, { force: true });
  }
  return { ok: false, error: failure };
}

function tapoBaseArgs(options) {
  const args = [];
  if (options.json) args.push("--json");
  if (options.timeout) args.push("--timeout", options.timeout);
  return args;
}

function controlBaseArgs(options, target) {
  const next = { ...options };
  if (!next.timeout && String(target).toLowerCase() === "all") {
    next.timeout = "2";
  }
  return tapoBaseArgs(next);
}

function normalizeHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
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

function formatDevice(device) {
  const name = device.alias || `Ampoule ${device.ip.split(".").at(-1)}`;
  const status = device.controllable
    ? device.is_on ? "on" : "off"
    : device.status || "indispo";
  const details = [];

  if (device.model) details.push(device.model);
  if (device.brightness != null) details.push(`${device.brightness}%`);
  if (device.color_temp) details.push(`${device.color_temp}K`);
  if (device.hsv) {
    details.push(`hsv=${device.hsv.hue},${device.hsv.saturation},${device.hsv.value}`);
  }
  if (device.error) details.push(device.error);

  return `${device.ip.padEnd(13)} ${status.padEnd(8)} ${name}${details.length ? ` (${details.join(" | ")})` : ""}`;
}

function printOutput(output, options) {
  if (!output) return;
  if (options.json) {
    console.log(output);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    console.log(output);
    return;
  }

  if (!parsed.devices) {
    console.log(output);
    return;
  }

  if (!parsed.devices.length) {
    console.log("Aucune ampoule trouvee.");
    return;
  }

  for (const device of parsed.devices) {
    console.log(formatDevice(device));
  }
}

function parseSceneArgs(args) {
  const next = [];
  const options = { transitionMs: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--transition") {
      const transition = args[index + 1];
      if (!transition || transition.startsWith("--")) fail("--transition attend une valeur en ms.");
      options.transitionMs = transition;
      index += 1;
    } else {
      next.push(value);
    }
  }
  return { args: next, options };
}

function printScene(scene) {
  const count = scene.devices?.length || 0;
  const transition = scene.transitionMs ?? 3000;
  console.log(`${scene.id.padEnd(18)} ${scene.name} (${count} ampoule${count > 1 ? "s" : ""}, ${transition}ms)`);
}

function listScenes(options) {
  const store = readScenesStore();
  if (options.json) {
    console.log(JSON.stringify(store));
    return;
  }
  if (!store.scenes.length) {
    console.log("Aucune ambiance enregistree.");
    return;
  }
  for (const scene of store.scenes) {
    printScene(scene);
  }
}

function saveCurrentScene(name, options) {
  const output = runTapo(["--json", "discover"]);
  const data = JSON.parse(output);
  const scene = saveScene(createSceneFromDevices(name, data.devices || [], {
    transitionMs: options.transitionMs,
  }));
  if (options.json) {
    console.log(JSON.stringify({ scene }));
    return;
  }
  console.log(`Ambiance enregistree: ${scene.name} (${scene.devices.length} ampoule${scene.devices.length > 1 ? "s" : ""})`);
}

function applyScene(name, options) {
  const scene = findScene(name);
  if (!scene) fail(`Ambiance introuvable: ${name}`);
  const updated = [];
  const errors = [];
  const transitionMs = options.transitionMs || scene.transitionMs || 3000;

  for (const command of sceneCommands(scene)) {
    const result = tryRunTapo([
      "--json",
      "--timeout",
      "2",
      "control",
      "--no-refresh",
      "--transition",
      String(transitionMs),
      command.ip,
      command.action,
      ...command.values,
    ]);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    const data = JSON.parse(result.output);
    updated.push(...(data.devices || []));
  }

  if (options.json) {
    console.log(JSON.stringify({ scene, devices: updated, errors }));
    return;
  }
  console.log(`Ambiance lancee: ${scene.name} (${transitionMs}ms)`);
  const lastByIp = new Map(updated.map((device) => [device.ip, device]));
  for (const device of lastByIp.values()) {
    console.log(formatDevice(device));
  }
  if (errors.length) {
    console.error(errors.join("\n"));
  }
}

function setSceneTransition(name, transitionMs, options) {
  const scene = updateSceneTransition(name, transitionMs);
  if (!scene) fail(`Ambiance introuvable: ${name}`);
  if (options.json) {
    console.log(JSON.stringify({ scene }));
    return;
  }
  console.log(`Transition mise a jour: ${scene.name} (${scene.transitionMs}ms)`);
}

function removeScene(name, options) {
  const scene = deleteScene(name);
  if (!scene) fail(`Ambiance introuvable: ${name}`);
  if (options.json) {
    console.log(JSON.stringify({ scene }));
    return;
  }
  console.log(`Ambiance supprimee: ${scene.name}`);
}

function handleScene(args, options) {
  const subcommand = args[0] || "list";
  const parsed = parseSceneArgs(args.slice(1));
  const sceneOptions = { ...options, ...parsed.options };
  const name = parsed.args.join(" ").trim();

  if (subcommand === "list" || subcommand === "ls") {
    listScenes(options);
    return;
  }
  if (subcommand === "save") {
    if (!name) fail("Syntaxe: domus scene save <nom>");
    saveCurrentScene(name, sceneOptions);
    return;
  }
  if (subcommand === "apply" || subcommand === "run") {
    if (!name) fail("Syntaxe: domus scene apply <nom>");
    applyScene(name, sceneOptions);
    return;
  }
  if (subcommand === "transition") {
    const transitionMs = parsed.args.at(-1);
    const sceneName = parsed.args.slice(0, -1).join(" ").trim();
    if (!sceneName || !transitionMs) fail("Syntaxe: domus scene transition <nom> <ms>");
    setSceneTransition(sceneName, transitionMs, options);
    return;
  }
  if (subcommand === "delete" || subcommand === "rm") {
    if (!name) fail("Syntaxe: domus scene delete <nom>");
    removeScene(name, options);
    return;
  }
  fail(`Commande d'ambiance inconnue: ${subcommand}`);
}

function requireCount(args, count, syntax) {
  if (args.length !== count) fail(`Syntaxe: ${syntax}`);
}

function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2));

  if (command === "help") usage();

  if (command === "scene" || command === "scenes") {
    handleScene(args, options);
    return;
  }

  if (command === "raw") {
    if (!args.length) fail("Syntaxe: domus raw <arguments tapo_lights.py>");
    console.log(runTapo(args));
    return;
  }

  if (command === "list" || command === "ls" || command === "status") {
    const output = runTapo([...tapoBaseArgs({ ...options, json: true }), "discover"]);
    printOutput(output, options);
    return;
  }

  let target = args[0];
  let action = command;
  let values = args.slice(1);

  if (command === "on" || command === "off") {
    target = args[0] || "all";
    values = [];
  } else if (command === "toggle") {
    requireCount(args, 1, `domus ${command} <cible>`);
    values = [];
  } else if (command === "brightness" || command === "dim") {
    requireCount(args, 2, `domus ${command} <cible> <1-100>`);
    action = "brightness";
  } else if (command === "temp" || command === "white") {
    if (args.length < 2 || args.length > 3) {
      fail(`Syntaxe: domus ${command} <cible> <kelvin> [brightness]`);
    }
    action = "temp";
  } else if (command === "color") {
    if (args.length < 2 || args.length > 4) {
      fail("Syntaxe: domus color <cible> <#RRGGBB> ou domus color <cible> <hue> <saturation> [value]");
    }
    const hsv = hexToHsv(args[1]);
    if (hsv) {
      values = hsv;
    } else {
      values = args.slice(1);
      if (values.length < 2 || values.length > 3) {
        fail("Couleur invalide. Utilise #RRGGBB ou hue saturation [value].");
      }
    }
  }

  const output = runTapo([
    ...controlBaseArgs({ ...options, json: true }, target),
    "control",
    target,
    action,
    ...values,
  ]);
  printOutput(output, options);
}

main();
