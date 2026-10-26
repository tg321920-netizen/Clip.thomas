import path from "node:path";
import { stat } from "node:fs/promises";
import { captureSegmentedStream, sanitizeIngestDiagnostic } from "../ingest/UrlIngestService.mjs";
import { hashFile } from "../ingest/ResumableUploadStore.mjs";
import { LiveSessionStore } from "./LiveSessionStore.mjs";
import { LiveObservationStore, sameLiveSource } from "./LiveObservationStore.mjs";
import { enqueueReadyLiveWindows } from "./LiveWindowService.mjs";
import { resolveKickSource } from "./KickPublicSourceService.mjs";
import { openKickChat } from "./KickChatSource.mjs";
import { withLocalStateLock } from "../../lib/atomic-local-state.mjs";

/** One recorder for the entire bounded session. Editorial/R2 work is never
 * awaited here. Closed TS originals are journaled before another worker uses
 * them. No source media is automatically deleted. */
export class LiveCaptureService {
  constructor({ sessions = new LiveSessionStore(), observations = new LiveObservationStore(), resolveSource = resolveKickSource,
    openChat = openKickChat, capture = captureSegmentedStream, capacity, enqueue = enqueueReadyLiveWindows } = {}) {
    Object.assign(this, { sessions, observations, resolveSource, openChat, capture, enqueue });
    this.capacity = capacity || (() => sessions.capacity());
  }
  async run(job, { signal, onProgress = async () => {}, captureOptions = {} } = {}) {
    const expected = job.source.expectedSource;
    if (!expected) throw new Error("La captura continua requiere una identidad de transmisión comprobada.");
    await this.sessions.create(job.id, expected);
    return withLocalStateLock(`${this.sessions.file(job.id)}.capture`, async () => {
      const resolved = await this.resolveSource(job.source.url, { signal });
      if (!sameLiveSource(resolved.metadata, expected)) {
        await this.sessions.update(job.id,s=>{s.capture={...s.capture,status:"SOURCE_CHANGED",errorCode:"LIVE_SOURCE_CHANGED"};});
        throw Object.assign(new Error("Cambió la transmisión. Los segmentos anteriores no se mezclan con ella."), { code: "LIVE_SOURCE_CHANGED" });
      }
      let chat = null, chatAttempts = 0, captureMetadata = null, snapshotting = null, lastCapacity = null, checkedAt = 0, finishing = false;
      const saved = await this.observations.loadForSource(expected, { includeCloud: expected.sourceKind === "VOD" });
      let retainedBins = mergeObservedChatBins(saved.bins);
      const publishChat = () => {
        if (snapshotting) return snapshotting;
        snapshotting = (async () => {
        try {
          if ((!chat || chat.snapshot().status === "DISCONNECTED") && expected.sourceKind === "LIVE" && expected.platform === "KICK" && chatAttempts < 3 && !finishing && !signal?.aborted) {
            if(chat) retainedBins = mergeObservedChatBins([...retainedBins,...chat.snapshot().bins]);
            chat?.close(); chatAttempts++;
            try { chat = await this.openChat({ channelId: expected.channelId, chatroomId: expected.chatroomId, signal }); }
            catch { chat = null; }
          }
          const current = chat?.snapshot();
          if (current) {
            await this.observations.save({ id: job.id, source: expected, bins: mergeObservedChatBins([...retainedBins, ...current.bins]), chatStatus: current.status, captureStatus: "CAPTURING" });
            await this.sessions.update(job.id, s => { s.chat = { status: current.status, acceptedMessages: current.acceptedMessages, connectionAttempts: chatAttempts }; });
          } else await this.sessions.update(job.id, s => { s.chat = { status: saved.bins.length ? "SAVED_OBSERVATIONS" : "UNAVAILABLE", acceptedMessages: 0, connectionAttempts: chatAttempts }; });
        } finally { snapshotting = null; }
        })();
        return snapshotting;
      };
      const state = await this.sessions.update(job.id, s => { s.selectionPolicy = { onlyChatReactions:job.source.onlyChatReactions !== false, preferChatReactions:job.source.preferChatReactions === true, chatReactionLagSeconds:job.source.chatReactionLagSeconds || 0 }; s.capture = { ...s.capture, lastFailure:s.capture.errorCode?{code:s.capture.errorCode,diagnostic:s.capture.diagnostic||null,at:s.capture.stoppedAt||null}:s.capture.lastFailure||null, errorCode:null, diagnostic:null, status: "CAPTURING", attempts: s.capture.attempts+1, startedAt: s.capture.startedAt || new Date().toISOString() }; });
      await publishChat();
      const timer = setInterval(() => { void publishChat().catch(() => {}); }, 5000); timer.unref();
      let failed = false;
      try {
        lastCapacity=await this.capacity();checkedAt=Date.now();
        if(!lastCapacity.allowed)throw Object.assign(new Error("Falta espacio para iniciar la captura."),{code:"LIVE_STORAGE_LIMIT"});
        const previous = state.segments.filter(s=>s.status==="CAPTURED").at(-1);
        const resumeSourceUtc = previous?.sourceStartUtc ? new Date(Date.parse(previous.sourceStartUtc)+previous.durationSeconds*1000).toISOString() : null;
        const result = await this.capture({ ...captureOptions, url: job.source.url, uploadDir: path.join(this.sessions.root,"live-sessions",job.id,"capture"),
          captureSeconds: job.source.captureSeconds || 21600, segmentSeconds: job.source.segmentSeconds || 60,
          startTimeSeconds: Number(job.source.startTimeSeconds || 0), signal, finalize: false, deliverOnInterruption: true, resumeSourceUtc,
          maxCaptureBytes: 2 * 1024 ** 3,
          startNumberFloor: state.segments.length ? Math.max(...state.segments.map(s=>s.index))+1 : 0,
          onSourceResolved: source => { if (!sameLiveSource(source, expected)) throw Object.assign(new Error("La señal corresponde a otra transmisión."), { code: "LIVE_SOURCE_CHANGED" }); },
          onDiagnostic: async event => {
            if(event.type!=="HLS_ERROR")return;
            await this.sessions.update(job.id,s=>{const errors=s.capture.recoverableErrors||[];errors.push({stage:event.stage,status:event.status,code:event.code,at:new Date().toISOString()});s.capture.recoverableErrors=errors.slice(-50);});
          },
          onCaptureMetadata: async metadata => {
            captureMetadata = metadata;
            const requested=Date.parse(metadata.windowStartUtc || metadata.playlistStartUtc),received=Date.parse(metadata.firstServedProgramUtc);
            if(!metadata.resumedSeconds && Number.isFinite(requested)&&Number.isFinite(received)&&received-requested>1000){
              const fromUtc=new Date(requested).toISOString(),toUtc=new Date(received).toISOString();
              await this.sessions.update(job.id,s=>{if(!s.gaps.some(g=>g.reason==="INITIAL_HLS_SEGMENTS_UNAVAILABLE"&&g.fromUtc===fromUtc&&g.toUtc===toUtc))s.gaps.push({fromUtc,toUtc,reason:"INITIAL_HLS_SEGMENTS_UNAVAILABLE",durationSeconds:(received-requested)/1000});});
            }
          },
          checkCapacity: async () => {
            if (Date.now()-checkedAt < 5000) return;
            lastCapacity = await this.capacity(); checkedAt = Date.now();
            if (!lastCapacity.allowed) throw Object.assign(new Error("La captura se detuvo por capacidad. Se conservan los originales y se registra el intervalo perdido."), { code: "LIVE_STORAGE_LIMIT" });
          },
          onProgress: async (progress, stage) => { await onProgress(progress,stage,{chatStatus:chat?.snapshot().status || "UNAVAILABLE",acceptedMessages:chat?.snapshot().acceptedMessages || 0}); },
          onSegment: async (file,index,context) => {
            const segment = { index, relativePath: path.relative(this.sessions.root,file).split(path.sep).join("/"),
              durationSeconds: context.durationSeconds, offsetSeconds: context.offsetSeconds, sourceStartUtc: context.sourceStartUtc,
              sha256: await hashFile(file), sizeBytes: (await stat(file)).size, closedAt: new Date().toISOString() };
            await this.sessions.addSegment(job.id,segment);
            await publishChat();
            await this.enqueue(job.id, { sessions:this.sessions, observations:this.observations, onlyChatReactions:job.source.onlyChatReactions !== false });
          },
        });
        await this.sessions.update(job.id,s=>{s.capture={...s.capture,status:"ENDED",completedAt:new Date().toISOString(),continuityBreaks:result.capture?.continuityBreaks || [],capacity:lastCapacity};});
        return { sessionId:job.id,segmentCount:(await this.sessions.get(job.id)).segments.length,originalsPreserved:true };
      } catch(error) {
        failed = true;
        const code = signal?.aborted ? "LIVE_INTERRUPTED" : error.code || "LIVE_CAPTURE_FAILED";
        await this.sessions.update(job.id,s=>{s.capture={...s.capture,status:code === "LIVE_STORAGE_LIMIT" ? "STORAGE_LIMIT" : "INTERRUPTED",errorCode:code,diagnostic:sanitizeIngestDiagnostic(error.message,1500),stoppedAt:new Date().toISOString(),capacity:lastCapacity};});
        const latest = (await this.sessions.get(job.id)).segments.at(-1);
        await this.sessions.gap(job.id,code,latest?.sourceStartUtc ? new Date(Date.parse(latest.sourceStartUtc)+latest.durationSeconds*1000).toISOString() : null);
        throw Object.assign(new Error("La captura no completó la sesión. Los segmentos y su diagnóstico están guardados."),{code,retryable:!["LIVE_STORAGE_LIMIT","LIVE_SOURCE_CHANGED"].includes(code)});
      } finally {
        finishing = true; clearInterval(timer); await publishChat().catch(()=>{}); chat?.close();
        const current = chat?.snapshot();
        if(current) await this.observations.save({id:job.id,source:expected,bins:mergeObservedChatBins([...retainedBins,...current.bins]),chatStatus:current.status,captureStatus:failed ? "INTERRUPTED" : "ENDED"});
        await this.enqueue(job.id,{sessions:this.sessions,observations:this.observations,onlyChatReactions:job.source.onlyChatReactions !== false});
        // Persist capture clocks, never a signed upstream URL or native headers.
        if(captureMetadata) await this.sessions.update(job.id,s=>{s.capture.sourceRanges=captureMetadata.sourceRanges || [];});
      }
    },{timeoutMs:1000});
  }
}

/** Reconnects retain completed buckets. Partial/replayed observations are never
 * summed, because their participant sets cannot be reconstructed safely. */
export function mergeObservedChatBins(bins) {
  const byTime = new Map();
  for (const bin of bins || []) {
    const time = Date.parse(bin.utc); if (!Number.isFinite(time)) continue;
    const previous = byTime.get(time);
    if (!previous || (bin.complete !== false && previous.complete === false) ||
      ((bin.complete !== false) === (previous.complete !== false) && bin.messages > previous.messages)) byTime.set(time,bin);
  }
  return [...byTime.values()].sort((a,b)=>Date.parse(a.utc)-Date.parse(b.utc)).slice(-1440);
}
