import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "../ingest/ResumableUploadStore.mjs";
import { extractWhisperAudio } from "../transcription/AudioExtractor.mjs";
import { createDefaultProvider } from "../transcription/TranscriptionService.mjs";
import { WaitingResourceError } from "./StoryProviderError.mjs";

const normalize = word => String(word).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Actual local ASR anchors, preserving the author's corrected reference text. */
export async function recognizeStoryNarration(filename, directory) {
  const provider = createDefaultProvider({ language: "es", wordTimestamps: true });
  const modelFile = provider.modelPath ? await stat(provider.modelPath).catch(() => null) : null;
  const signature = JSON.stringify({ audio: await hashFile(filename), model: provider.modelPath || provider.model, size: modelFile?.size, modified: modelFile?.mtimeMs, version: 1 });
  const cacheFile = path.join(directory, "narration-timing.json");
  const cached = await readFile(cacheFile, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (cached?.signature === signature && cached.transcript?.segments?.length) return cached.transcript;
  const audio = path.join(directory, "alignment.wav");
  await extractWhisperAudio(filename, audio);
  const transcript = await provider.transcribe(audio, path.join(directory, "alignment"));
  await writeFile(cacheFile, JSON.stringify({ signature, transcript }));
  return transcript;
}

export function alignStoryNarration(reference, transcript, duration) {
  const expected = String(reference).trim().split(/\s+/).filter(Boolean);
  const recognized = [];
  for (const segment of transcript.segments || []) {
    const words = segment.words?.length ? segment.words : String(segment.text).trim().split(/\s+/).map((text, i, list) => ({ text, startTime: segment.startTime + (segment.endTime - segment.startTime) * i / list.length, endTime: segment.startTime + (segment.endTime - segment.startTime) * (i + 1) / list.length, approximated: true }));
    for (const word of words) if (normalize(word.text) && word.endTime > word.startTime) recognized.push(word);
  }
  if (!expected.length || expected.length > 1000 || !recognized.length || recognized.length > 2000) throw new WaitingResourceError("No hay tiempos de voz utilizables para alinear este relato.");
  const a = expected.map(normalize), b = recognized.map(word => normalize(word.text));
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (j > 1 && a[i - 1] === b[j - 2] + b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 1][j - 2]);
  }
  const anchors = new Map(); let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 1 && a[i - 1] === b[j - 2] + b[j - 1] && rows[i][j] === rows[i - 1][j - 2]) {
      anchors.set(i - 1, { ...recognized[j - 2], endTime: recognized[j - 1].endTime, mergedRecognitionTokens: true });
      i--; j -= 2;
    } else if (i > 0 && j > 0 && rows[i][j] === rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
      if (a[i - 1] === b[j - 1]) anchors.set(i - 1, recognized[j - 1]);
      i--; j--;
    } else if (i > 0 && rows[i][j] === rows[i - 1][j] + 1) i--;
    else j--;
  }
  const coverage = anchors.size / a.length, wordErrorRate = rows[a.length][b.length] / a.length;
  if (coverage < 0.8 || wordErrorRate > 0.25) throw new WaitingResourceError("El audio y el relato no coinciden suficientemente, o Whisper no los reconoce con claridad. Revisa el texto o utiliza una grabación más clara/modelo local más preciso.");
  if (!anchors.has(a.length - 1) || a.some((word, index) => ["no", "nunca", "sin", "jamas", "nadie"].includes(word) && !anchors.has(index))) throw new WaitingResourceError("No se confirmó el final o una negación importante de la narración. Revisa el audio y el texto antes de generar subtítulos.");
  const aligned = expected.map((text, index) => {
    const anchor = anchors.get(index);
    if (anchor) return { ...anchor, text };
    let before = index - 1, after = index + 1;
    while (before >= 0 && !anchors.has(before)) before--;
    while (after < expected.length && !anchors.has(after)) after++;
    const start = anchors.get(before)?.endTime || 0, end = anchors.get(after)?.startTime ?? duration;
    const length = after - before - 1, position = index - before - 1;
    return { text, startTime: start + Math.max(0.01, end - start) * position / length, endTime: start + Math.max(0.01, end - start) * (position + 1) / length, approximated: true };
  });
  let previousEnd = 0;
  for (const word of aligned) {
    word.startTime = Math.min(duration - 0.001, Math.max(previousEnd, word.startTime));
    word.endTime = Math.min(duration, Math.max(word.startTime + 0.001, word.endTime));
    previousEnd = word.endTime;
  }
  const cues = [];
  for (const word of aligned) {
    let cue = cues.at(-1);
    if (!cue || cue.words >= 6 || cue.text.length + word.text.length > 34 || /[.!?]$/.test(cue.text)) {
      cue = { text: "", startTime: word.startTime, endTime: word.endTime, words: 0 }; cues.push(cue);
    }
    cue.text = `${cue.text} ${word.text}`.trim(); cue.endTime = word.endTime; cue.words++;
  }
  return { cues, words: aligned, coverage, wordErrorRate, approximatedWords: aligned.filter(word => word.approximated).length, method: "ASR_ANCHORED_REFERENCE_WITH_INTERPOLATION", reviewRequired: true };
}
