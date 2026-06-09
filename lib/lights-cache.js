const defaultTtlMs = 15_000;

const cache = globalThis.__domusLightsCache || {
  data: null,
  fetchedAt: 0,
};

globalThis.__domusLightsCache = cache;

function readLightsCache(ttlMs = defaultTtlMs) {
  if (!cache.data || Date.now() - cache.fetchedAt > ttlMs) return null;
  return {
    ...cache.data,
    cached: true,
    fetchedAt: cache.fetchedAt,
  };
}

function writeLightsCache(data) {
  cache.data = {
    ...data,
    devices: Array.isArray(data.devices) ? data.devices : [],
  };
  cache.fetchedAt = Date.now();
  return cache.data;
}

function mergeLightsCache(devices) {
  if (!Array.isArray(devices) || !devices.length) return cache.data;

  const currentDevices = Array.isArray(cache.data?.devices) ? cache.data.devices : [];
  const nextByIp = new Map(currentDevices.map((device) => [device.ip, device]));

  for (const device of devices) {
    if (!device?.ip) continue;
    nextByIp.set(device.ip, {
      ...(nextByIp.get(device.ip) || {}),
      ...device,
    });
  }

  cache.data = {
    ...(cache.data || {}),
    devices: [...nextByIp.values()],
  };
  cache.fetchedAt = Date.now();
  return cache.data;
}

module.exports = {
  defaultTtlMs,
  mergeLightsCache,
  readLightsCache,
  writeLightsCache,
};
