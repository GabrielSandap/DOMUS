import { runTapo } from "../../tapo";
import { mergeLightsCache } from "../../../../lib/lights-cache";

export const dynamic = "force-dynamic";
const allowedActions = new Set(["on", "off", "toggle", "brightness", "temp", "color"]);

export async function POST(request, context) {
  const { ip } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const values = Array.isArray(body.values) ? body.values.map(String) : [];
  const target = Array.isArray(body.targets) && body.targets.length
    ? body.targets.map(String).join(",")
    : ip;

  if (!allowedActions.has(action)) {
    return Response.json({ error: "Action inconnue" }, { status: 400 });
  }

  try {
    const timeoutArgs = ip === "all" ? ["--timeout", "2"] : [];
    const output = await runTapo([
      "--json",
      ...timeoutArgs,
      "control",
      "--no-refresh",
      target,
      action,
      ...values,
    ], 20000);
    const data = JSON.parse(output);
    mergeLightsCache(data.devices || []);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        error: error.stderr || error.stdout || error.message || "Commande impossible",
      },
      { status: 500 }
    );
  }
}
