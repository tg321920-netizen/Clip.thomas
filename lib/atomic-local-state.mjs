import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { leaseOwner, ownerIsAlive } from "./process-lease.mjs";

export async function writeAtomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

/** Single-host lock shared by capture, ingest and archive workers. A live PID
 * never loses its lease because a request or an encode takes longer than a TTL. */
export async function withLocalStateLock(file, action, { timeoutMs = 4000, staleMs = 120000 } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.mutation-lock`, owner = { ...leaseOwner(), nonce: randomUUID() }, deadline = Date.now() + timeoutMs;
  for (;;) {
    try { const handle = await open(lock, "wx", 0o600); await handle.writeFile(JSON.stringify(owner)); await handle.close(); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const saved = JSON.parse(await readFile(lock, "utf8")), info = await stat(lock);
        if (!ownerIsAlive(saved) && Date.now() - info.mtimeMs > staleMs) { await rm(lock, { force: true }); continue; }
      } catch (failure) { if (failure.code === "ENOENT") continue; }
      if (Date.now() >= deadline) throw Object.assign(new Error("El estado está ocupado; se conserva para reintentar."), { code: "STATE_BUSY" });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await action(); }
  finally {
    const saved = JSON.parse(await readFile(lock, "utf8").catch(() => "null"));
    if (saved?.nonce === owner.nonce) await rm(lock, { force: true });
  }
}
