/** Upload up to two story assets concurrently, preserving visual order and confirmed progress. */
export type StoryAssetProgress = { onProgress?: (saved: number, total: number) => void; signal?: AbortSignal };
const VALID_MIME = new Set(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4"]);
const MAX_BYTES = 4 * 1024 * 1024;
const transient = (status: number) => status === 408 || status === 429 || status >= 500;

function invalidAccess(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "NotReadableError" ||
    /requested file could not be read|file could not be read|permission problems after a reference|notreadableerror/i.test(error.message)
  );
}
function throwReadable(error: unknown): never {
  if (invalidAccess(error)) throw new Error("Android perdió acceso a una imagen o audio. Selecciona de nuevo los archivos para continuar.");
  throw error;
}
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Carga cancelada", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const cancel = () => { clearTimeout(timer); reject(new DOMException("Carga cancelada", "AbortError")); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
export async function uploadStoryAsset(file: File, signal?: AbortSignal): Promise<string> {
  if (!VALID_MIME.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
    throw new Error(`${file.name}: formato no admitido o tamaño superior a 4 MB.`);
  }
  try { await file.slice(0, Math.min(32, file.size)).arrayBuffer(); }
  catch (error) { return throwReadable(error); }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw new DOMException("Carga cancelada", "AbortError");
    try {
      const response = await fetch("/api/media/assets", {
        method: "POST", cache: "no-store", signal, body: file,
        headers: { "Content-Type": file.type, "X-Rights-Confirmed": "true" },
      });
      const payload = await response.json().catch(() => ({})) as { relativePath?: string; error?: string };
      if (response.ok) {
        const saved = payload.relativePath || "";
        if (!/^story-assets\/[a-f0-9-]+\.(jpg|png|webp|mp3|wav|m4a)$/.test(saved)) throw new Error("El servidor no confirmó que el archivo se guardó.");
        return saved;
      }
      if (!transient(response.status) || attempt === 3) throw new Error(payload.error || `Error HTTP ${response.status} al guardar ${file.name}.`);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (invalidAccess(error)) return throwReadable(error);
      if (error instanceof Error && !(/fetch|network|load failed|http 5\d\d|http 408|http 429|servidor interrumpió/i.test(error.message)) && !(error instanceof TypeError)) throw error;
      if (attempt === 3) throw new Error(`No se pudo guardar ${file.name} después de cuatro intentos. La conexión o el servidor se interrumpió; vuelve a pulsar Crear historia para continuar.`);
    }
    await pause(400 * 2 ** attempt, signal);
  }
  throw new Error(`No se pudo guardar ${file.name}.`);
}
/** Cached URLs are kept only for the current page. Do not report success until the server acknowledges each file. */
export async function uploadStoryAssets(files: File[], cache: Map<File, string>, options: StoryAssetProgress = {}): Promise<string[]> {
  if (!files.length) return [];
  const paths = new Array<string>(files.length);
  let next = 0, saved = 0;
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const path = cache.get(file) || await uploadStoryAsset(file, options.signal);
      cache.set(file, path);
      paths[index] = path;
      options.onProgress?.(++saved, files.length);
    }
  }));
  if (paths.some(path => !path)) throw new Error("No se confirmaron todos los recursos de la historia.");
  return paths;
}
