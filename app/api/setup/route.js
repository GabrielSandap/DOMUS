import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const envPath = path.join(process.cwd(), ".env");

function parseDotenv(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function readEnv() {
  if (!fs.existsSync(envPath)) return {};
  return parseDotenv(fs.readFileSync(envPath, "utf8"));
}

function envLine(key, value) {
  return `${key}=${String(value || "").replace(/\r?\n/g, "")}`;
}

function writeEnv(values) {
  const current = readEnv();
  const next = {
    ...current,
    ...values,
  };

  const lines = [
    envLine("TAPO_EMAIL", next.TAPO_EMAIL),
    envLine("TAPO_PASSWORD", next.TAPO_PASSWORD),
    "",
    "# Separe les IP par des virgules.",
    envLine("TAPO_KNOWN_IPS", next.TAPO_KNOWN_IPS),
    "",
    "# Format: 192.168.1.42=Salon,192.168.1.43=Bureau",
    envLine("TAPO_KNOWN_ALIASES", next.TAPO_KNOWN_ALIASES),
    "",
  ];

  fs.writeFileSync(envPath, lines.join("\n"));

  for (const [key, value] of Object.entries(next)) {
    if (key.startsWith("TAPO_")) process.env[key] = value;
  }

  return next;
}

function setupState(values = readEnv()) {
  const knownIps = String(values.TAPO_KNOWN_IPS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    configured: Boolean(values.TAPO_EMAIL && values.TAPO_PASSWORD),
    email: values.TAPO_EMAIL || "",
    hasPassword: Boolean(values.TAPO_PASSWORD),
    knownIps,
    knownAliases: values.TAPO_KNOWN_ALIASES || "",
  };
}

function serializeAliases(devices = []) {
  return devices
    .filter((device) => device?.ip && device?.alias)
    .map((device) => `${device.ip}=${String(device.alias).replace(/[,\r\n]/g, " ").trim()}`)
    .join(",");
}

export async function GET() {
  return Response.json(setupState());
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const current = readEnv();
  const devices = Array.isArray(body.devices) ? body.devices : [];
  const knownIps = Array.isArray(body.knownIps)
    ? body.knownIps.map(String)
    : devices.map((device) => device?.ip).filter(Boolean);

  const patch = {
    TAPO_EMAIL: String(body.email ?? current.TAPO_EMAIL ?? "").trim(),
    TAPO_PASSWORD: body.password
      ? String(body.password)
      : String(current.TAPO_PASSWORD || ""),
    TAPO_KNOWN_IPS: knownIps.length
      ? [...new Set(knownIps)].join(",")
      : String(body.knownIpsText ?? current.TAPO_KNOWN_IPS ?? "").trim(),
    TAPO_KNOWN_ALIASES: body.knownAliasesText != null
      ? String(body.knownAliasesText).trim()
      : devices.length
        ? serializeAliases(devices)
        : String(current.TAPO_KNOWN_ALIASES ?? "").trim(),
  };

  if (!patch.TAPO_EMAIL || !patch.TAPO_PASSWORD) {
    return Response.json(
      { error: "TAPO_EMAIL et TAPO_PASSWORD sont requis." },
      { status: 400 }
    );
  }

  const next = writeEnv(patch);
  return Response.json(setupState(next));
}
