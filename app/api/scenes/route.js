import {
  createSceneFromDevices,
  readScenesStore,
  saveScene,
} from "../../../lib/scenes";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readScenesStore());
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const scene = saveScene(createSceneFromDevices(body.name, body.devices || [], {
      transitionMs: body.transitionMs,
    }));
    return Response.json({ scene });
  } catch (error) {
    return Response.json(
      { error: error.message || "Ambiance impossible a enregistrer" },
      { status: 400 }
    );
  }
}
