import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../coastfire-calculator/index.html", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tags = (re) => [...html.matchAll(re)].map((m) => m[0]);

const externalScripts = tags(/<script\b[^>]*\bsrc="(?:https?:)?\/\/[^"]*"[^>]*>/g);
const externalStyles = tags(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(?:https?:)?\/\/[^"]*"[^>]*>/g);

describe("subresource integrity", () => {
  it("every external script and stylesheet carries integrity and crossorigin", () => {
    assert.ok(externalScripts.length > 0, "expected the Chart.js script tag");
    for (const tag of [...externalScripts, ...externalStyles]) {
      assert.match(tag, /\bintegrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, tag);
      assert.match(tag, /\bcrossorigin="anonymous"/, tag);
    }
  });

  it("the Chart.js URL pins the exact version in package.json", () => {
    const [tag] = externalScripts;
    const url = tag.match(/src="([^"]+)"/)[1];
    assert.match(url, new RegExp(`chart\\.js@${pkg.devDependencies["chart.js"].replace(/\./g, "\\.")}/dist/chart\\.umd\\.js$`));
  });

  it("the integrity hash matches the pinned Chart.js build", () => {
    const [tag] = externalScripts;
    const [, algo, expected] = tag.match(/integrity="(sha\d+)-([^"]+)"/);
    const file = readFileSync(new URL("../node_modules/chart.js/dist/chart.umd.js", import.meta.url));
    assert.equal(createHash(algo).update(file).digest("base64"), expected);
  });
});
