import test from "node:test";
import assert from "node:assert/strict";
import { PUBLISHING_ENABLED, assertPublishingAllowed } from "../lib/publishing-policy.mjs";
test("real publishing remains off regardless of environment", () => {
  assert.equal(PUBLISHING_ENABLED, false);
  assert.throws(() => assertPublishingAllowed({ requirements: () => ({}) }), /PUBLISHING = OFF/);
  assert.throws(() => assertPublishingAllowed(), /PUBLISHING = OFF/);
});
test("explicitly injected mock providers can exercise local tests", () => {
  assert.doesNotThrow(() => assertPublishingAllowed({ requirements: () => ({ mock: true }) }));
});
