import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnedContentRuntimeUrl,
  ownedContentRuntimeHref,
} from "../lib/owned-content-runtime.mjs";

test("owned content stays local outside Vercel runtime split", () => {
  assert.equal(getOwnedContentRuntimeUrl({}), null);
  assert.equal(ownedContentRuntimeHref("/factory", null, {}), null);
});

test("Vercel owned content routes to the media runtime and preserves story parameters", () => {
  const env = {
    VERCEL: "1",
    CLIPFORGE_CONTENT_RUNTIME_URL: "https://runtime.example.com/",
  };
  const href = ownedContentRuntimeHref(
    "/factory/new",
    { topic: "Story", trendId: "abc", sourceCount: ["2", "3"] },
    env,
  );
  const url = new URL(href);
  assert.equal(url.origin, "https://runtime.example.com");
  assert.equal(url.pathname, "/factory/new");
  assert.equal(url.searchParams.get("topic"), "Story");
  assert.equal(url.searchParams.get("trendId"), "abc");
  assert.deepEqual(url.searchParams.getAll("sourceCount"), ["2", "3"]);
});

test("owned content runtime refuses insecure HTTP targets", () => {
  assert.throws(
    () => getOwnedContentRuntimeUrl({ VERCEL: "1", CLIPFORGE_CONTENT_RUNTIME_URL: "http://runtime.example.com" }),
    /must use HTTPS/i,
  );
});
