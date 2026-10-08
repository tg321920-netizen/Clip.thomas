type Session = { id: string; token: string; chunkSize: number; chunkCount: number; status: string; received?: number[] };
type Job = { id: string; status: string; stage: string; error?: string; result?: { video?: unknown } };

/** Only transfer/hashing run on the phone. Probing and rendering run in workers. */
export async function uploadResumable(file: File, options: {
  signal: AbortSignal;
  onProgress: (percent: number, stage: string) => void;
  onQueued: (id: string) => void;
}) {
  const fingerprint = await sha256(await new Blob([file.slice(0, 65536), file.slice(Math.max(0, file.size - 65536)), `${file.name}:${file.size}:${file.lastModified}`]).arrayBuffer());
  const key = `clipforge-upload:${fingerprint}`;
  let session: Session | null = null;
  try { session = JSON.parse(localStorage.getItem(key) || "null") as Session | null; } catch { /* A fresh session still works when browser storage is unavailable. */ }
  let status: { session: Session; job?: Job } | null = null;
  if (session) {
    try { status = await jsonRequest(`/api/videos/uploads/${session.id}`, { headers: tokenHeaders(session), signal: options.signal }); }
    catch (error) { if (!(error instanceof HttpError) || ![403, 404, 410].includes(error.status)) throw error; session = null; }
  }
  if (!session) {
    const created = await jsonRequest<{ session: Session }>("/api/videos/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size }), signal: options.signal });
    session = created.session;
    try { localStorage.setItem(key, JSON.stringify(session)); } catch { /* Retries within this screen still work. */ }
  }
  const current = session;
  if (status?.session.status !== "QUEUED") {
    const received = new Set(status?.session.received || []);
    let savedBytes = [...received].reduce((sum, i) => sum + Math.min(current.chunkSize, file.size - i * current.chunkSize), 0);
    options.onProgress(Math.floor(savedBytes / file.size * 100), "Subiendo");
    for (let index = 0; index < current.chunkCount; index++) {
      if (received.has(index)) continue;
      const chunk = file.slice(index * current.chunkSize, Math.min(file.size, (index + 1) * current.chunkSize));
      const hash = await sha256(await chunk.arrayBuffer());
      await retry(async () => {
        await jsonRequest(`/api/videos/uploads/${current.id}/chunks/${index}`, { method: "PUT", headers: { ...tokenHeaders(current), "Content-Type": "application/octet-stream", "X-Chunk-SHA256": hash }, body: chunk, signal: options.signal });
      }, options.signal);
      savedBytes += chunk.size;
      options.onProgress(Math.floor(savedBytes / file.size * 100), "Subiendo");
    }
    await retry(() => jsonRequest(`/api/videos/uploads/${current.id}`, { method: "POST", headers: tokenHeaders(current), signal: options.signal }), options.signal);
  }
  options.onQueued(current.id);
  options.onProgress(100, "Subida completa. Analizando en el servidor");
  for (;;) {
    if (options.signal.aborted) throw new DOMException("Subida pausada", "AbortError");
    const response = await jsonRequest<{ session: Session; job?: Job }>(`/api/videos/uploads/${current.id}`, { headers: tokenHeaders(current), signal: options.signal });
    if (response.job?.status === "COMPLETED" && response.job.result?.video) {
      try { localStorage.removeItem(key); } catch { /* No browser storage. */ }
      return response.job.result.video;
    }
    if (response.job?.status === "FAILED") throw new Error(response.job.error || "No se pudo analizar el archivo. Puedes reintentar desde Mis videos.");
    // Polling does not manufacture progress. Transfer progress remains at 100%.
    await delay(2000, options.signal);
  }
}
function tokenHeaders(session: Session) { return { "X-Upload-Token": session.token }; }
async function sha256(bytes: ArrayBuffer) { const hash = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join(""); }
class HttpError extends Error { constructor(message: string, public status: number) { super(message); } }
async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new HttpError(payload.error || payload.message || `Error HTTP ${response.status}`, response.status);
  return payload;
}
async function retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (signal.aborted || attempt >= 3 || (error instanceof HttpError && ![408, 409, 429, 500, 502, 503, 504].includes(error.status))) throw error;
      await delay(Math.min(8000, 1000 * 2 ** attempt), signal);
    }
  }
}
function delay(ms: number, signal: AbortSignal) { return new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("Subida pausada", "AbortError")); return; }
  const abort = () => { clearTimeout(timer); reject(new DOMException("Subida pausada", "AbortError")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
}); }
