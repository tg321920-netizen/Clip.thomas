import { readBoundedJson } from "../../lib/bounded-json.mjs";
import { ResumableUploadStore, UploadError } from "./ResumableUploadStore.mjs";
import { IngestJobStore } from "./IngestJobStore.mjs";

/** These are the actual route handlers; no Next build or socket is required to
 * exercise their Web Request/Response contract with the disk and job stores. */
export function createUploadHandlers(options = {}) {
  const uploads = options.uploads || new ResumableUploadStore();
  const jobs = options.jobs || new IngestJobStore();
  const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const failure = error => json({ error: error instanceof Error ? error.message : "La subida falló.", code: error instanceof UploadError ? error.code : "UPLOAD_FAILED" }, error instanceof UploadError ? error.status : 500);
  return {
    async create(request) {
      try { return json({ session: await uploads.create(await readBoundedJson(request, 4096)) }, 201); }
      catch (error) {
        if (error instanceof UploadError) return failure(error);
        return json({ error: error instanceof Error ? error.message : "Solicitud inválida.", code: "UPLOAD_INVALID" }, 400);
      }
    },
    async status(request, uploadId) {
      try { return json({ session: await uploads.status(uploadId, request.headers.get("x-upload-token")), job: await jobs.get(uploadId) }); }
      catch (error) { return failure(error); }
    },
    async chunk(request, uploadId, index) {
      try {
        if (!request.body || !/^\d+$/.test(String(index))) throw new UploadError("Fragmento inválido.");
        return json(await uploads.putChunk(uploadId, request.headers.get("x-upload-token"), Number(index), request.body, request.headers.get("x-chunk-sha256"), request.signal));
      } catch (error) { return failure(error); }
    },
    async finalize(request, uploadId) {
      try {
        const session = await uploads.finalize(uploadId, request.headers.get("x-upload-token"), input => jobs.enqueueUpload(input));
        return json({ session, job: await jobs.get(uploadId) }, 202);
      } catch (error) { return failure(error); }
    },
  };
}
