import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceRepository } from "../services/sources/SourceRepository.mjs";
import { SourceService } from "../services/sources/SourceService.mjs";
import { ExtractionService } from "../services/extraction/ExtractionService.mjs";
import { extractPublicWebPage } from "../services/extraction/WebPageExtractor.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-marketing-sources-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("text source extracts useful marketing signals", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const sources = new SourceService({ repository });
    const extractions = new ExtractionService({ repository, sources });

    const source = await sources.create({
      type: "TEXT",
      text:
        "Hotel Bosque Verde. Habitación ₡45.000 por noche. Horario 08:00 a 18:00. " +
        "Escribinos por WhatsApp al +506 8888-7777 o reservas@bosque.test. Solicita una demostración.",
    });
    const extraction = await extractions.extract(source.id);

    assert.equal(source.authorizationStatus, "USER_PROVIDED");
    assert.equal(extraction.status, "COMPLETED");
    assert.ok(extraction.signals.prices.includes("₡45.000"));
    assert.ok(extraction.signals.emails.includes("reservas@bosque.test"));
    assert.ok(extraction.signals.phones.some((phone) => phone.includes("506")));
    assert.ok(extraction.signals.ctaCandidates.length > 0);

    const refreshed = await sources.get(source.id);
    assert.equal(refreshed.latestExtractionId, extraction.id);
  });
});

test("URL source requires explicit authorization and can be extracted", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const parseUrl = async (value) => new URL(String(value));
    const sources = new SourceService({ repository, parseUrl });

    await assert.rejects(
      () => sources.create({ type: "URL", url: "https://example.test/product" }),
      /authorization confirmation/i,
    );

    const source = await sources.create({
      type: "URL",
      url: "https://example.test/product#details",
      authorizationConfirmed: true,
    });
    const extractions = new ExtractionService({
      repository,
      sources,
      extractWebPage: async () => ({
        url: "https://example.test/product",
        title: "MetaBot para hoteles",
        description: "Responde consultas automáticamente.",
        text: "Plan ₡25.000. Contactanos por WhatsApp para solicitar una demo.",
        contentType: "text/html",
        bytesRead: 120,
      }),
    });

    const extraction = await extractions.extract(source.id);
    assert.equal(source.authorizationStatus, "USER_CONFIRMED");
    assert.equal(source.input.url, "https://example.test/product");
    assert.ok(extraction.text.includes("MetaBot para hoteles"));
    assert.ok(extraction.signals.prices.includes("₡25.000"));
  });
});

test("ClipForge project source reuses existing transcript and analysis", async () => {
  await withStorage(async (root) => {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await writeFile(
      path.join(root, "projects", `${PROJECT_ID}.json`),
      JSON.stringify(
        {
          id: PROJECT_ID,
          createdAt: "2026-09-28T00:00:00.000Z",
          source: {
            projectId: PROJECT_ID,
            originalName: "hotel-demo.mp4",
            durationSeconds: 30,
            width: 1080,
            height: 1920,
          },
          transcript: {
            status: "COMPLETED",
            segments: [
              { id: "s1", startTime: 0, endTime: 8, text: "El huésped pregunta disponibilidad." },
              { id: "s2", startTime: 8, endTime: 16, text: "MetaBot responde en segundos." },
            ],
          },
          analysis: {
            status: "COMPLETED",
            candidates: [
              {
                id: "c1",
                title: "Respuesta automática",
                hook: "No pierdas otra consulta",
                text: "MetaBot responde en segundos.",
                startTime: 8,
                endTime: 16,
                viralScore: 88,
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const repository = new SourceRepository();
    const sources = new SourceService({ repository });
    const source = await sources.create({ type: "CLIPFORGE_PROJECT", projectId: PROJECT_ID });
    const extractions = new ExtractionService({ repository, sources });
    const extraction = await extractions.extract(source.id);

    assert.equal(source.authorizationStatus, "INTERNAL");
    assert.ok(extraction.text.includes("El huésped pregunta disponibilidad."));
    assert.equal(extraction.metadata.transcriptSegments, 2);
    assert.equal(extraction.metadata.candidateCount, 1);
    assert.equal(extraction.metadata.topCandidates[0].viralScore, 88);
  });
});

test("web extractor validates every redirect and strips executable HTML", async () => {
  const parsed = [];
  const parseUrl = async (value) => {
    const url = new URL(String(value));
    parsed.push(url.hostname);
    return url;
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.test/page" },
      });
    }
    return new Response(
      "<html><head><title>Oferta &amp; Demo</title><meta name=\"description\" content=\"Automatiza consultas\"></head>" +
        "<body><script>secret()</script><h1>MetaBot</h1><p>Plan ₡20.000.</p></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };

  const page = await extractPublicWebPage("https://example.test/start", {
    parseUrl,
    fetchImpl,
  });

  assert.deepEqual(parsed, ["example.test", "cdn.example.test"]);
  assert.equal(page.url, "https://cdn.example.test/page");
  assert.equal(page.title, "Oferta & Demo");
  assert.equal(page.description, "Automatiza consultas");
  assert.ok(page.text.includes("MetaBot"));
  assert.ok(!page.text.includes("secret()"));
});
