import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripVersions, computeVersion, stampText, assetReferences } from "../scripts/assets.mjs";
import { ASSET_DIR, readAssets } from "../scripts/stamp-assets.mjs";

describe("stripVersions", () => {
  it("removes ?v= stamps", () => {
    assert.equal(stripVersions('src="app.js?v=0a1b2c" from "./calc.js?v=ff"'), 'src="app.js" from "./calc.js"');
  });
  it("leaves unstamped text alone", () => {
    assert.equal(stripVersions("const v = 1;"), "const v = 1;");
  });
});

describe("computeVersion", () => {
  const files = { "a.js": 'import "./b.js";', "b.js": "export {};" };
  it("is a 10-char hex hash", () => assert.match(computeVersion(files), /^[0-9a-f]{10}$/));
  it("ignores key order and existing stamps", () => {
    const stamped = { "b.js": "export {};", "a.js": 'import "./b.js?v=1234abcd";' };
    assert.equal(computeVersion(stamped), computeVersion(files));
  });
  it("changes when any file's content changes", () => {
    assert.notEqual(computeVersion({ ...files, "b.js": "export const x = 1;" }), computeVersion(files));
  });
  it("changes when a file is renamed", () => {
    assert.notEqual(computeVersion({ "a.js": files["a.js"], "c.js": files["b.js"] }), computeVersion(files));
  });
});

describe("stampText", () => {
  it("stamps local CSS/JS references in HTML but not external URLs", () => {
    const html = '<link href="style.css"><script src="https://cdn.example/x.js"></script><script src="app.js?v=00aa11"></script>';
    assert.equal(stampText("index.html", html, "abc"),
      '<link href="style.css?v=abc"><script src="https://cdn.example/x.js"></script><script src="app.js?v=abc"></script>');
  });
  it("stamps static, side-effect and dynamic relative imports in JS", () => {
    const js = 'import { a } from "./calc.js";\nimport "./side.js";\nawait import("./lazy.js");\nimport fs from "node:fs";';
    assert.equal(stampText("app.js", js, "abc"),
      'import { a } from "./calc.js?v=abc";\nimport "./side.js?v=abc";\nawait import("./lazy.js?v=abc");\nimport fs from "node:fs";');
  });
  it("stamps worker URLs but not other new URL() calls", () => {
    const js = 'new Worker(new URL("./mc-worker.js", import.meta.url), { type: "module" });\nnew URL("https://x.test/a.js");';
    assert.equal(stampText("app.js", js, "abc"),
      'new Worker(new URL("./mc-worker.js?v=abc", import.meta.url), { type: "module" });\nnew URL("https://x.test/a.js");');
  });
  it("leaves CSS and other files unchanged", () => {
    assert.equal(stampText("style.css", '@import "x.css";', "abc"), '@import "x.css";');
  });
  it("is idempotent", () => {
    const once = stampText("app.js", 'from "./calc.js"', "abc");
    assert.equal(stampText("app.js", once, "abc"), once);
  });
});

describe("assetReferences", () => {
  it("lists local references with their versions", () => {
    assert.deepEqual(assetReferences("index.html", '<link href="style.css?v=ab"><script src="app.js"></script>'),
      [{ path: "style.css", version: "ab" }, { path: "app.js", version: null }]);
  });
  it("returns nothing for other file types", () => {
    assert.deepEqual(assetReferences("style.css", "body{}"), []);
  });
});

// Regression: after a deploy, browsers used the new index.html with cached
// app.js/style.css from the previous version, which broke the text boxes.
describe("coastfire-calculator assets (regression: stale cache after deploy)", () => {
  const files = readAssets();
  const version = computeVersion(files);

  it("references the page's own CSS and JS", () => {
    const paths = assetReferences("index.html", files["index.html"]).map((r) => r.path);
    assert.ok(paths.includes("style.css") && paths.includes("app.js"));
  });

  for (const [name, text] of Object.entries(files)) {
    for (const ref of assetReferences(name, text)) {
      it(`${name} → ${ref.path} exists and is stamped with the current version (run \`npm run stamp\`)`, () => {
        assert.ok(existsSync(join(ASSET_DIR, ref.path)), `${ref.path} does not exist`);
        assert.equal(ref.version, version);
      });
    }
  }
});
