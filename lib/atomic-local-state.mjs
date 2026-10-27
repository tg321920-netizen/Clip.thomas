import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { leaseOwner, ownerIsAlive } from "./process-lease.mjs";

export async function writeAtomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Single-host lock shared by capture, ingest and archive workers. A live PID
 * never loses its lease because a request or an encode takes longer than a TTL. */
export async function withLocalStateLock(file, action, { timeoutMs = 4000, staleMs = 120000 } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.mutation-lock`, owner = { ...leaseOwner(), nonce: randomUUID() }, deadline = Date.now() + timeoutMs;
  for (;;) {
    let handle;
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(JSON.stringify(owner));
      await handle.close(); handle = null;
      break;
    }
    catch (error) {
      // The exclusive create succeeded but writing its owner failed. This
      // invocation still owns that incomplete lock; release it for a retry.
      if (handle) {
        await handle.close().catch(() => {});
        await rm(lock, { force: true });
        throw error;
      }
      if (error.code !== "EEXIST") throw error;
      try {
        const info = await stat(lock);
        let saved;
        try { saved = JSON.parse(await readFile(lock, "utf8")); }
        catch (failure) { if (!(failure instanceof SyntaxError)) throw failure; }
        const identified = Number.isSafeInteger(saved?.pid) && saved.pid > 0;
        // A writer may be between exclusive creation and its owner write.
        // Unlike a confirmed dead owner, incomplete legacy locks need grace,
        // even for render slots whose dead-owner staleMs is deliberately zero.
        const graceMs = identified ? staleMs : Math.max(staleMs, 5000);
        if (!ownerIsAlive(saved) && Date.now() - info.mtimeMs > graceMs) {
          const current = await stat(lock);
          if (current.ino === info.ino && current.dev === info.dev && current.mtimeMs === info.mtimeMs && current.size === info.size) {
            await rm(lock, { force: true }); continue;
          }
        }
      } catch (failure) { if (failure.code === "ENOENT") continue; throw failure; }
      if (Date.now() >= deadline) throw Object.assign(new Error("El estado está ocupado; se conserva para reintentar."), { code: "STATE_BUSY" });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await action(); }
  finally {
    let saved;
    try { saved = JSON.parse(await readFile(lock, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    if (saved?.nonce === owner.nonce) await rm(lock, { force: true });
  }
}
