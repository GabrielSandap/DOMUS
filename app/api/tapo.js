import { execFile } from "node:child_process";
import { open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const python = process.env.TAPO_PYTHON_BIN || ".venv/bin/python";
const script = process.env.TAPO_SCRIPT || "tapo_lights.py";
const lockPath = path.join(root, ".tapo-api.lock");
const lockStaleMs = 60_000;
const lockPollMs = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  while (true) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > lockStaleMs) {
          await unlink(lockPath).catch(() => {});
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }

      await sleep(lockPollMs);
    }
  }
}

export async function runTapo(args, timeout = 30000) {
  const lock = await acquireLock();
  try {
    const { stdout } = await execFileAsync(python, [script, ...args], {
      cwd: root,
      env: process.env,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } finally {
    await lock.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
