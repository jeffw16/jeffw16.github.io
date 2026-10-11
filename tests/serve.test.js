import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePath, MIME } from "../scripts/serve.mjs";

const root = "/srv/site/";

describe("resolvePath", () => {
  it("maps URL paths under the root", () => {
    assert.equal(resolvePath("/coastfire-calculator/app.js", root), "/srv/site/coastfire-calculator/app.js");
    assert.equal(resolvePath("/", root), "/srv/site/");
  });
  it("ignores the query string and decodes escapes", () => {
    assert.equal(resolvePath("/a%20b.css?v=1", root), "/srv/site/a b.css");
  });
  it("rejects paths that escape the root", () => {
    assert.equal(resolvePath("/../etc/passwd", root), null);
    assert.equal(resolvePath("/%2e%2e/%2e%2e/etc/passwd", root), null);
    assert.equal(resolvePath("/../site-other/x", root), null);
  });
  it("rejects malformed escapes", () => {
    assert.equal(resolvePath("/%E0%A4%A", root), null);
  });
});

describe("MIME", () => {
  it("serves ES modules as JavaScript", () => {
    assert.match(MIME[".js"], /^text\/javascript/);
    assert.match(MIME[".mjs"], /^text\/javascript/);
  });
});
