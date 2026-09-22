import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";

const STYLES = new Set(["CLEAN", "VIRAL", "KARAOKE"]);

export async function getSubtitleTrack(projectId, clipId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;

  const clip = findClip(project, clipId);
  if (!clip) return null;

  return clip.subtitles || null;
}

export async function generateSubtitleTrack(projectId, clipId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");

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

  clip.subtitles = track;
  clip.edit = {
    ...clip.edit,
    subtitlesEnabled: options.enabled !== false,
    subtitleStyle: style,
  };
  clip.subtitles.enabled = clip.edit.subtitlesEnabled;

  invalidateClipRender(clip);
  await replaceProjectFile(projectId, project);

  return clip.subtitles;
}

export async function updateSubtitleTrack(projectId, clipId, input = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");

  if (!clip.subtitles) {
    throw new Error("Subtitle track has not been generated.");
  }

  const style = normalizeSubtitleStyle(
    input.style || clip.subtitles.style || clip.edit?.subtitleStyle,
  );
  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : clip.subtitles.enabled !== false;

  const cues = Array.isArray(input.cues)
    ? sanitizeSubtitleCues(input.cues, Number(clip.duration))
    : clip.subtitles.cues;

  if (!Array.isArray(cues) || cues.length === 0) {
    throw new Error("Subtitle track must contain at least one valid cue.");
  }

  clip.subtitles = {
    ...clip.subtitles,
    enabled,
    style,
    cues,
    updatedAt: new Date().toISOString(),
  };

  clip.edit = {
    ...clip.edit,
    subtitlesEnabled: enabled,
    subtitleStyle: style,
  };

  invalidateClipRender(clip);
  await replaceProjectFile(projectId, project);

  return clip.subtitles;
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
    const text = String(segment?.text || "").trim();

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

  return cues
    .map((cue, index) => sanitizeCue(cue, index, duration))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

export function buildAssDocument(track) {
  const style = normalizeSubtitleStyle(track?.style);
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const styleLine = assStyleLine(style);

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
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
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
      const text = String(word?.text || "").trim();

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

  const words = Array.isArray(cue?.words)
    ? cue.words
        .map((word) => sanitizeWord(word, startTime, endTime))
        .filter(Boolean)
    : [];

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

function invalidateClipRender(clip) {
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
