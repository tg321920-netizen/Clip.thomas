import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductProfileService } from "../services/marketing-brain/ProductProfileService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-products-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("product marketing profiles remain independent from external repositories", async () => {
  await withStorage(async () => {
    const service = new ProductProfileService();
    const created = await service.create({
      name: "MetaBot",
      description: "Automatización de atención para negocios.",
      audience: "Restaurantes pequeños",
      country: "Costa Rica",
      branding: {
        brandName: "MetaBot",
        tone: "claro y útil",
        colors: ["verde", "blanco"],
      },
      cta: "Solicitar una demostración",
      frequency: {
        postsPerDay: 3,
        preferredTimes: ["09:00", "15:00", "20:00"],
      },
      platforms: ["FACEBOOK", "TIKTOK", "YOUTUBE"],
      objectives: ["generar interés", "obtener clientes"],
    });

    assert.equal(created.name, "MetaBot");
    assert.deepEqual(created.platforms, ["FACEBOOK", "TIKTOK", "YOUTUBE"]);
    assert.equal(created.frequency.postsPerDay, 3);
    assert.equal(Object.hasOwn(created, "repository"), false);

    const listed = await service.list({ country: "Costa Rica", active: true });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);
  });
});
