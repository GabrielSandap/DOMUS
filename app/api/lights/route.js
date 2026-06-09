import { runTapo } from "../tapo";
import {
  readLightsCache,
  writeLightsCache,
} from "../../../lib/lights-cache";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const fast = url.searchParams.get("fast") === "1";
  const preferCache = url.searchParams.get("cache") === "1";
  const currentCache = readLightsCache();

  if (preferCache && currentCache) {
    return Response.json(currentCache);
  }

  try {
    const output = await runTapo([
      "--json",
      "--timeout",
      fast ? "2" : "4",
      "discover",
      ...(fast ? ["--known-only"] : []),
    ]);
    const data = JSON.parse(output);
    writeLightsCache(data);
    const updatedCache = readLightsCache();
    return Response.json({
      ...updatedCache,
      cached: false,
    });
  } catch (error) {
    const fallbackCache = readLightsCache(60_000);
    if (fallbackCache) {
      return Response.json({
        ...fallbackCache,
        warning: error.stderr || error.message || "Detection lente, cache utilise",
      });
    }

    return Response.json(
      {
        devices: [],
        error: error.stderr || error.message || "Erreur de detection",
      },
      { status: 500 }
    );
  }
}
