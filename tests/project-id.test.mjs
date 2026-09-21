import test from "node:test";
import assert from "node:assert/strict";
import { isProjectId } from "../lib/project-id.mjs";

test("accepts generated UUID project ids", () => {
  assert.equal(isProjectId("8e56073f-ae3a-4c2c-a73d-b11085dbd1b6"), true);
});

test("rejects traversal and malformed project ids", () => {
  assert.equal(isProjectId("../storage"), false);
  assert.equal(isProjectId("8e56073f-ae3a-4c2c-a73d-b11085dbd1b6/../../x"), false);
  assert.equal(isProjectId("not-a-project"), false);
  assert.equal(isProjectId(""), false);
});
