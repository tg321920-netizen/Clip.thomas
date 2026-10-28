import { loadProjectFile, updateProjectFile } from "../../lib/project-files.mjs";
import { LocalTranslationProvider } from "./LocalTranslationProvider.mjs";
import { spokenTranscriptText } from "../../lib/transcript-normalizer.mjs";
import { createHash } from 'node:crypto';
import { assessTranslation, normalizeGlossary, subtitleReadability, TRANSLATION_PIPELINE_VERSION } from './TranslationQualityService.mjs';

const STYLES = new Set(["CLEAN", "VIRAL", "KARAOKE"]);
export const SUBTITLE_MODES = ["NONE", "ORIGINAL_ES", "ORIGINAL_EN", "TRANSLATE_ES"];

export async function requestSubtitleMode(projectId, clipId, mode, style = "CLEAN") {
  if (!SUBTITLE_MODES.includes(mode)) throw new Error("Modo de subtítulos inválido.");
  return updateProjectFile(projectId, project => {
    const clip = findClip(project, clipId);
    if (!clip) throw new Error("Clip not found.");
    assertSubtitleEditable(clip);
    clip.edit = { ...clip.edit, subtitleMode: mode, subtitleStyle: normalizeSubtitleStyle(style), subtitlesEnabled: mode !== "NONE", subtitleRegenerate: true };
    // Keep previous texts recoverable until the new track has succeeded.
    invalidateClipRender(clip);
    return clip;
  });
}

/** Called by the existing render worker; never performs inference in a route. */
export async function prepareSubtitleTrack(project, clip, { translator = new LocalTranslationProvider() } = {}) {
  const mode = clip.edit?.subtitleMode;
  if (!mode || mode === "NONE") return null;
  if (!clip.edit.subtitleRegenerate && clip.subtitles?.mode === mode && clip.subtitles?.sourceTranscriptId === project.transcript?.id) return clip.subtitles;
  const expected = mode === "ORIGINAL_ES" ? "es" : "en";
  if (project.transcript?.language !== expected) throw Object.assign(new Error(`El audio detectado no es ${expected === "es" ? "español" : "inglés"}. Revisa la transcripción y el idioma seleccionado.`),{code:'SUBTITLE_LANGUAGE_MISMATCH',retryable:false});
  const source = buildSubtitleTrack({ transcript: project.transcript, clip, style: clip.edit.subtitleStyle });
  if (!source.cues.length) throw new Error("No hay texto transcrito en este intervalo.");
  if (mode !== "TRANSLATE_ES") return { ...source, mode, language: expected, timingBasis: "SOURCE_TRANSCRIPT", reviewStatus: "PENDING" };
  // Translate complete sentence groups, rather than isolated eight-word chunks.
  const groups = [];
  for (const cue of source.cues) {
    const previous = groups.at(-1);
    if (previous && cue.startTime - previous.endTime <= 0.6 && !/[.!?…]["'”)]?$/.test(previous.text) && previous.text.length + cue.text.length < 850 && cue.endTime - previous.startTime <= 18) {
      previous.text += " " + cue.text; previous.endTime = cue.endTime;
    } else groups.push({ startTime: cue.startTime, endTime: cue.endTime, text: cue.text });
  }
  const glossary = normalizeGlossary(project.translationSettings?.glossary);
  const transcript = project.transcript.segments || [];
  const contexts = groups.map(group => ({
    before: transcript.filter(s=>s.endTime <= clip.startTime+group.startTime+.001).slice(-2).map(s=>spokenTranscriptText(s.text)).join(' '),
    after: transcript.filter(s=>s.startTime >= clip.startTime+group.endTime-.001).slice(0,2).map(s=>spokenTranscriptText(s.text)).join(' '),
  }));
  const translated = await translator.translate(groups.map(c => c.text), { contexts, glossary });
  if (translated.texts.length !== groups.length) throw new Error("Cantidad de traducciones inválida.");
  const segments = groups.map((cue, index) => ({ ...cue, text: translated.texts[index] }));
  const track = buildSubtitleTrack({ transcript: { id: project.transcript.id, segments }, clip: { startTime: 0, endTime: clip.duration, duration: clip.duration }, style: clip.edit.subtitleStyle });
  const units = groups.map((group,index) => ({ ...group, target: translated.texts[index],
    direct: translated.units?.[index]?.direct, contextUsed: translated.units?.[index]?.contextUsed || false,
    quality: assessTranslation(group.text, translated.texts[index], { glossary, duration: group.endTime-group.startTime, issues: translated.units?.[index]?.issues }) }));
  return { ...track, mode, layout: clip.subtitles?.layout, language: "es", sourceLanguage: "en", sourceCues: source.cues, timingBasis: "SOURCE_SENTENCE_INTERVALS", reviewStatus: "REVIEW_REQUIRED",
    readability: subtitleReadability(track.cues),
    translation: { provider: translated.provider, modelSha256: translated.modelSha256,
      modelId:translated.modelId, modelRevision:translated.modelRevision, modelLicense:translated.modelLicense, modelFormat:translated.modelFormat,
      pipelineVersion: translated.pipelineVersion || TRANSLATION_PIPELINE_VERSION,
      glossary, units, audioReplaced: false, reviewRequired: true } };
}

export async function getSubtitleTrack(projectId, clipId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;

  const clip = findClip(project, clipId);
  if (!clip) return null;

  return clip.subtitles || null;
}

export async function generateSubtitleTrack(projectId, clipId, options = {}) {
  return updateProjectFile(projectId, project => {
  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");
  assertSubtitleEditable(clip);

  const transcript = project.transcript;
  if (
    !transcript ||
    transcript.status !== "COMPLETED" ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0
  ) {
    throw new Error("A completed transcript is required for subtitles.");
  }

  const style = normalizeSubtitleStyle(options.style || clip.edit?.subtitleStyle);
  const track = buildSubtitleTrack({
    transcript,
    clip,
    style,
  });

  if (track.cues.length === 0) {
    throw new Error("No transcript content overlaps this clip.");
  }

  rememberSubtitleVersion(clip, 'REGENERATED');
  clip.subtitles = track;
  clip.edit = {
    ...clip.edit,
    subtitlesEnabled: options.enabled !== false,
    subtitleStyle: style,
  };
  clip.subtitles.enabled = clip.edit.subtitlesEnabled;

  invalidateClipRender(clip);
  return clip.subtitles;
  });
}

export async function updateSubtitleTrack(projectId, clipId, input = {}) {
  return updateProjectFile(projectId, project => {
  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");
  assertSubtitleEditable(clip);

  if (!clip.subtitles) {
    throw new Error("Subtitle track has not been generated.");
  }
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== clip.subtitles.updatedAt) {
    throw Object.assign(new Error('Los subtítulos cambiaron en otra sesión. Vuelve a abrir el editor para comparar; no se sobrescribió ninguna versión.'), { code: 'SUBTITLE_STALE' });
  }

  const style = normalizeSubtitleStyle(
    input.style || clip.subtitles.style || clip.edit?.subtitleStyle,
  );
  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : clip.subtitles.enabled !== false;
  const layout = input.layout === undefined ? clip.subtitles.layout : normalizeSubtitleLayout(input.layout);

  const cues = Array.isArray(input.cues)
    ? sanitizeSubtitleCues(input.cues, Number(clip.duration))
    : clip.subtitles.cues;

  if (!Array.isArray(cues) || cues.length === 0) {
    throw new Error("Subtitle track must contain at least one valid cue.");
  }
  const cueSignature = items => JSON.stringify(items.map(c => ({ id: c.id, startTime: c.startTime, endTime: c.endTime, text: c.text,
    words: c.words?.map(w => ({ startTime: w.startTime, endTime: w.endTime, text: w.text })) })));
  if (style === clip.subtitles.style && enabled === (clip.subtitles.enabled !== false) && JSON.stringify(layout) === JSON.stringify(clip.subtitles.layout) && cueSignature(cues) === cueSignature(clip.subtitles.cues)) {
    return clip.subtitles;
  }

  rememberSubtitleVersion(clip, 'MANUAL_EDIT');
  clip.subtitles = {
    ...clip.subtitles,
    ...(clip.subtitles.translation && Array.isArray(input.cues) ? {
      machineCues: clip.subtitles.machineCues || clip.subtitles.cues,
      translation: { ...clip.subtitles.translation, manuallyEdited: true, reviewRequired: true },
      reviewStatus: "REVIEW_REQUIRED",
    } : {}),
    enabled,
    style,
    ...(layout ? { layout } : {}),
    cues,
    readability: subtitleReadability(cues),
    updatedAt: new Date().toISOString(),
  };

  clip.edit = {
    ...clip.edit,
    subtitlesEnabled: enabled,
    subtitleStyle: style,
  };

  invalidateClipRender(clip);
  return clip.subtitles;
  });
}

export function rememberSubtitleVersion(clip, reason) {
  if (!clip.subtitles) return;
  const track = structuredClone(clip.subtitles);
  const versionId = createHash('sha256').update(JSON.stringify(track)).digest('hex');
  clip.subtitleHistory ||= [];
  if (clip.subtitleHistory.some(version=>version.versionId===versionId)) return;
  const version = { versionId, savedAt: new Date().toISOString(), reason, track };
  if (clip.subtitleHistory.length >= 30 || Buffer.byteLength(JSON.stringify([...clip.subtitleHistory,version])) > 180_000) {
    throw new Error('El historial alcanzó su límite seguro de esta versión. La edición queda pausada para conservarlo; puedes descargar las versiones SRT. No se borró ninguna corrección.');
  }
  clip.subtitleHistory.push(version);
}

export async function restoreSubtitleVersion(projectId, clipId, versionId) {
  return updateProjectFile(projectId, project => {
    const clip = findClip(project,clipId); if (!clip) throw new Error('Clip not found.');
    assertSubtitleEditable(clip);
    const version = clip.subtitleHistory?.find(v=>v.versionId===versionId);
    if (!version) throw new Error('Subtitle version not found.');
    rememberSubtitleVersion(clip,'BEFORE_RESTORE');
    clip.subtitles = { ...structuredClone(version.track), updatedAt: new Date().toISOString() };
    clip.edit = { ...clip.edit, subtitleMode: clip.subtitles.mode || clip.edit?.subtitleMode,
      subtitleStyle: clip.subtitles.style, subtitlesEnabled: clip.subtitles.enabled, subtitleRegenerate: false };
    invalidateClipRender(clip); return clip.subtitles;
  });
}

export function normalizeSubtitleLayout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuración visual de subtítulos inválida.');
  const fontSize = Number(value.fontSize ?? 54), marginPercent = Number(value.marginPercent ?? 9.4);
  const position = value.position || 'BOTTOM', color = value.color || '#FFFFFF';
  if (!Number.isFinite(fontSize) || fontSize < 32 || fontSize > 96 || !Number.isFinite(marginPercent) || marginPercent < 3 || marginPercent > 22 ||
    !['TOP','BOTTOM'].includes(position) || !/^#[a-f0-9]{6}$/iu.test(color)) throw new Error('Tamaño, posición, margen o color de subtítulos inválidos.');
  return { fontSize, position, marginPercent, color: color.toUpperCase() };
}

export function assertSubtitleEditable(clip) {
  if (["QUEUED", "RENDERING", "PROCESSING"].includes(clip?.status)) {
    throw Object.assign(new Error("Espera a que termine el trabajo antes de cambiar la edición."), { code: "SUBTITLE_BUSY" });
  }
}

export function buildSrtDocument(track) {
  const cues = sanitizeSubtitleCues(track?.cues, Math.max(...(track?.cues || []).map(c => Number(c.endTime)), 0));
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.startTime)} --> ${srtTime(cue.endTime)}\n${cue.text.replace(/\r/g, "").replace(/\n\s*\n/g, "\n")}\n`).join("\n");
}

function srtTime(value) {
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export function buildSubtitleTrack({ transcript, clip, style = "CLEAN" }) {
  const normalizedStyle = normalizeSubtitleStyle(style);
  const clipStart = Number(clip?.startTime);
  const clipEnd = Number(clip?.endTime);
  const clipDuration = Number(clip?.duration);

  if (
    !Number.isFinite(clipStart) ||
    !Number.isFinite(clipEnd) ||
    !Number.isFinite(clipDuration) ||
    clipEnd <= clipStart ||
    clipDuration <= 0
  ) {
    throw new Error("Clip timing is invalid.");
  }

  const maxWords = normalizedStyle === "CLEAN" ? 8 : 6;
  const cues = [];

  for (const segment of transcript?.segments || []) {
    const segmentStart = Number(segment?.startTime);
    const segmentEnd = Number(segment?.endTime);
    const text = spokenTranscriptText(segment?.text);

    if (
      !Number.isFinite(segmentStart) ||
      !Number.isFinite(segmentEnd) ||
      segmentEnd <= clipStart ||
      segmentStart >= clipEnd ||
      !text
    ) {
      continue;
    }

    const wordCues = buildWordCues(
      segment.words,
      clipStart,
      clipEnd,
      maxWords,
    );

    if (wordCues.length > 0) {
      cues.push(...wordCues);
      continue;
    }

    const startTime = round(Math.max(segmentStart, clipStart) - clipStart);
    const endTime = round(Math.min(segmentEnd, clipEnd) - clipStart);

    cues.push(
      ...splitTextCue({
        text,
        startTime,
        endTime,
        maxWords,
      }),
    );
  }

  const normalizedCues = cues
    .filter(
      (cue) =>
        cue.text &&
        cue.endTime > cue.startTime &&
        cue.startTime < clipDuration,
    )
    .map((cue, index) => ({
      ...cue,
      id: `cue-${String(index + 1).padStart(4, "0")}`,
      startTime: round(Math.max(0, cue.startTime)),
      endTime: round(Math.min(clipDuration, cue.endTime)),
    }))
    .filter((cue) => cue.endTime > cue.startTime);

  const now = new Date().toISOString();

  return {
    enabled: true,
    style: normalizedStyle,
    sourceTranscriptId: String(transcript?.id || ""),
    cues: normalizedCues,
    generatedAt: now,
    updatedAt: now,
  };
}

export function sanitizeSubtitleCues(cues, clipDuration) {
  if (!Array.isArray(cues)) {
    throw new Error("Subtitle cues must be an array.");
  }
  if (cues.length > 500) {
    throw new Error("Subtitle track exceeds the maximum of 500 cues.");
  }

  const duration = Number(clipDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Clip duration is invalid.");
  }

  const result = cues
    .map((cue, index) => sanitizeCue(cue, index, duration))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  if (result.some((cue, index) => index > 0 && cue.startTime < result[index - 1].endTime - 0.001)) {
    throw new Error("Los subtítulos se solapan. Ajusta sus tiempos antes de guardar.");
  }
  return result;
}

export function buildAssDocument(track, { width = 1080, height = 1920 } = {}) {
  const style = normalizeSubtitleStyle(track?.style);
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const base = assStyleLine(style).split(',');
  const layout = track?.layout ? normalizeSubtitleLayout(track.layout) : null;
  base[2] = String(Math.max(18,Math.round((layout?.fontSize ?? Number(base[2])) * height / 1920)));
  if (layout) { const rgb = layout.color.slice(1); base[3] = '&H00'+rgb.slice(4,6)+rgb.slice(2,4)+rgb.slice(0,2); base[18] = layout.position === 'TOP' ? '8' : '2'; }
  base[19] = String(Math.round(Number(base[19])*width/1080)); base[20] = String(Math.round(Number(base[20])*width/1080));
  base[21] = String(Math.round(layout ? height*layout.marginPercent/100 : Number(base[21])*height/1920));
  const styleLine = base.join(',');

  const events = cues
    .filter(
      (cue) =>
        Number.isFinite(Number(cue?.startTime)) &&
        Number.isFinite(Number(cue?.endTime)) &&
        Number(cue.endTime) > Number(cue.startTime) &&
        String(cue?.text || "").trim(),
    )
    .map((cue) => {
      const text =
        style === "KARAOKE" && Array.isArray(cue.words) && cue.words.length > 0
          ? karaokeText(cue.words)
          : escapeAssText(cue.text);

      return [
        "Dialogue: 0",
        assTime(Number(cue.startTime)),
        assTime(Number(cue.endTime)),
        "Default",
        "",
        "0",
        "0",
        "0",
        "",
        text,
      ].join(",");
    });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    styleLine,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...events,
    "",
  ].join("\n");
}

export function normalizeSubtitleStyle(value) {
  const normalized = String(value || "CLEAN").trim().toUpperCase();
  return STYLES.has(normalized) ? normalized : "CLEAN";
}

function buildWordCues(words, clipStart, clipEnd, maxWords) {
  if (!Array.isArray(words) || words.length === 0) return [];

  const normalized = words
    .map((word) => {
      const start = Number(word?.startTime);
      const end = Number(word?.endTime);
      const text = spokenTranscriptText(word?.text);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= clipStart ||
        start >= clipEnd ||
        !text
      ) {
        return null;
      }

      return {
        startTime: round(Math.max(start, clipStart) - clipStart),
        endTime: round(Math.min(end, clipEnd) - clipStart),
        text,
      };
    })
    .filter(Boolean)
    .filter((word) => word.endTime > word.startTime);

  if (normalized.length === 0) return [];

  const groups = [];
  let current = [];

  for (const word of normalized) {
    if (current.length && word.startTime - current[current.length - 1].endTime > 0.6) {
      groups.push(current);
      current = [];
    }
    current.push(word);

    const span = current[current.length - 1].endTime - current[0].startTime;
    const punctuationEnd = /[.!?…]["'»”)]?$/.test(word.text);

    if (
      current.length >= maxWords ||
      span >= 3.2 ||
      punctuationEnd
    ) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) groups.push(current);

  return groups.map((group) => ({
    startTime: group[0].startTime,
    endTime: group[group.length - 1].endTime,
    text: joinWords(group.map((word) => word.text)),
    words: group,
  }));
}

function splitTextCue({ text, startTime, endTime, maxWords }) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || endTime <= startTime) return [];

  if (words.length <= maxWords) {
    return [{ startTime, endTime, text: words.join(" ") }];
  }

  const groups = [];
  for (let index = 0; index < words.length; index += maxWords) {
    groups.push(words.slice(index, index + maxWords));
  }

  const totalWords = words.length;
  const duration = endTime - startTime;
  let consumed = 0;

  return groups.map((group, index) => {
    const cueStart = startTime + duration * (consumed / totalWords);
    consumed += group.length;
    const cueEnd =
      index === groups.length - 1
        ? endTime
        : startTime + duration * (consumed / totalWords);

    return {
      startTime: round(cueStart),
      endTime: round(cueEnd),
      text: group.join(" "),
    };
  });
}

function sanitizeCue(cue, index, clipDuration) {
  const startTime = Number(cue?.startTime);
  const endTime = Number(cue?.endTime);
  const text = String(cue?.text || "").trim();

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < 0 ||
    endTime <= startTime ||
    endTime > clipDuration + 0.001
  ) {
    throw new Error(`Subtitle cue ${index + 1} has invalid timing.`);
  }

  if (!text) {
    throw new Error(`Subtitle cue ${index + 1} has empty text.`);
  }

  if (text.length > 300) {
    throw new Error(`Subtitle cue ${index + 1} exceeds 300 characters.`);
  }

  const idValue = String(cue?.id || "");
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(idValue)
    ? idValue
    : `cue-${String(index + 1).padStart(4, "0")}`;

  let words = Array.isArray(cue?.words)
    ? cue.words
        .map((word) => sanitizeWord(word, startTime, endTime))
        .filter(Boolean)
    : [];
  // Edited/translated text must never burn the old words in KARAOKE mode.
  if (joinWords(words.map(word => word.text)) !== text) words = [];

  return {
    id,
    startTime: round(startTime),
    endTime: round(endTime),
    text,
    ...(words.length > 0 ? { words } : {}),
  };
}

function sanitizeWord(word, cueStart, cueEnd) {
  const startTime = Number(word?.startTime);
  const endTime = Number(word?.endTime);
  const text = String(word?.text || "").trim();

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < cueStart - 0.05 ||
    endTime > cueEnd + 0.05 ||
    endTime <= startTime ||
    !text
  ) {
    return null;
  }

  return {
    startTime: round(startTime),
    endTime: round(endTime),
    text,
  };
}

export function invalidateClipRender(clip) {
  clip.editRevision = Number(clip.editRevision || 0) + 1;
  clip.status = "DRAFT";
  clip.render = null;
  clip.error = null;
  clip.updatedAt = new Date().toISOString();
}

function findClip(project, clipId) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  return clips.find((clip) => clip.id === clipId) || null;
}

function assStyleLine(style) {
  if (style === "VIRAL") {
    return "Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,1,2,70,70,260,1";
  }

  if (style === "KARAOKE") {
    return "Style: Default,Arial,66,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,240,1";
  }

  return "Style: Default,Arial,54,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,180,1";
}

function karaokeText(words) {
  return words
    .map((word) => {
      const durationCs = Math.max(
        1,
        Math.round((Number(word.endTime) - Number(word.startTime)) * 100),
      );
      return `{\\k${durationCs}}${escapeAssText(word.text)}`;
    })
    .join(" ");
}

function escapeAssText(value) {
  return String(value)
    .replaceAll("\\", "∖")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\r?\n/g, "\\N")
    .trim();
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function joinWords(words) {
  return words
    .join(" ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/([¿¡])\s+/g, "$1")
    .trim();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
