import {
  deleteScene,
  findScene,
  readScenesStore,
  sceneCommands,
  updateScene,
  updateSceneTransition,
} from "../../../../lib/scenes";
import { mergeLightsCache } from "../../../../lib/lights-cache";
import { runTapo } from "../../tapo";

export const dynamic = "force-dynamic";

function getSceneOrResponse(id) {
  const scene = findScene(id);
  if (!scene) {
    return Response.json({ error: "Ambiance introuvable" }, { status: 404 });
  }
  return scene;
}

export async function POST(_request, context) {
  const { id } = await context.params;
  const scene = getSceneOrResponse(id);
  if (scene instanceof Response) return scene;

  const updated = [];
  const errors = [];
  const groupedCommands = new Map();

  for (const command of sceneCommands(scene)) {
    const key = `${command.action}:${command.values.join(",")}`;
    const group = groupedCommands.get(key) || {
      action: command.action,
      values: command.values,
      ips: [],
    };
    group.ips.push(command.ip);
    groupedCommands.set(key, group);
  }

  for (const command of groupedCommands.values()) {
    try {
      const output = await runTapo(
        [
          "--json",
          "--timeout",
          "2",
          "control",
          "--no-refresh",
          "--transition",
          String(scene.transitionMs ?? 3000),
          command.ips.join(","),
          command.action,
          ...command.values,
        ],
        20000
      );
      const data = JSON.parse(output);
      updated.push(...(data.devices || []));
    } catch (error) {
      errors.push(error.stderr || error.stdout || error.message || "Commande impossible");
    }
  }

  mergeLightsCache(updated);
  return Response.json({ scene, devices: updated, errors });
}

export async function DELETE(_request, context) {
  const { id } = await context.params;
  const scene = deleteScene(id);
  if (!scene) {
    return Response.json({ error: "Ambiance introuvable" }, { status: 404 });
  }
  return Response.json({ scene, scenes: readScenesStore().scenes });
}

export async function PATCH(request, context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    const scene = body.devices || body.name
      ? updateScene(id, body)
      : updateSceneTransition(id, body.transitionMs);
    if (!scene) {
      return Response.json({ error: "Ambiance introuvable" }, { status: 404 });
    }
    return Response.json({ scene, scenes: readScenesStore().scenes });
  } catch (error) {
    return Response.json(
      { error: error.message || "Ambiance impossible a modifier" },
      { status: 400 }
    );
  }
}
