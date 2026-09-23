import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewsBriefFromTranscript,
  classifyNews,
} from "../services/news/NewsSummaryService.mjs";

test("News Mode classifies technology content and keeps extractive evidence", () => {
  const transcript = {
    id: "transcript-1",
    segments: [
      {
        id: "segment-1",
        startTime: 0,
        endTime: 8,
        text: "Una empresa anunció hoy un nuevo sistema de inteligencia artificial para teléfonos móviles.",
      },
      {
        id: "segment-2",
        startTime: 8,
        endTime: 17,
        text: "La tecnología procesará parte de la información directamente en el dispositivo.",
      },
      {
        id: "segment-3",
        startTime: 17,
        endTime: 27,
        text: "Según la presentación, el software estará disponible primero en tres modelos nuevos.",
      },
    ],
  };

  const brief = buildNewsBriefFromTranscript(transcript, { targetWords: 60 });
  const sourceText = transcript.segments.map((segment) => segment.text).join(" ");

  assert.equal(brief.category, "TECH");
  assert.equal(brief.template, "TECH");
  assert.ok(brief.headline.length > 0);
  assert.ok(brief.sourceEvidence.length > 0);
  assert.ok(
    brief.sourceEvidence.every((evidence) => sourceText.includes(evidence.text)),
  );
  assert.equal(
    brief.narration,
    brief.sourceEvidence.map((evidence) => evidence.text).join(" "),
  );
  assert.match(brief.disclaimer, /únicamente/i);
});

test("breaking keywords choose the BREAKING template", () => {
  const result = classifyNews(
    "Última hora: autoridades reportaron una emergencia después del incendio.",
  );

  assert.equal(result.category, "BREAKING");
  assert.equal(result.template, "BREAKING");
});
