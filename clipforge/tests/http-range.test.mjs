import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../lib/http-range.mjs";

test("parses an explicit byte range", () => {
  assert.deepEqual(parseByteRange("bytes=0-1023", 5000), {
    start: 0,
    end: 1023,
  });
});

test("caps the range at the end of the file", () => {
  assert.deepEqual(parseByteRange("bytes=4900-9999", 5000), {
    start: 4900,
    end: 4999,
  });
});

test("supports suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=-100", 5000), {
    start: 4900,
    end: 4999,
  });
});

test("supports open-ended ranges", () => {
  assert.deepEqual(parseByteRange("bytes=100-", 5000), {
    start: 100,
    end: 4999,
  });
});

test("rejects invalid and multipart ranges", () => {
  assert.equal(parseByteRange("bytes=5000-5001", 5000), null);
  assert.equal(parseByteRange("bytes=100-50", 5000), null);
  assert.equal(parseByteRange("bytes=0-1,3-4", 5000), null);
  assert.equal(parseByteRange("items=0-10", 5000), null);
});
