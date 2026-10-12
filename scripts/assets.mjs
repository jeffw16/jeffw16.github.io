// Cache-busting for the static calculator. GitHub Pages lets browsers cache
// CSS/JS for ~10 minutes, so after a deploy a fresh index.html could run with
// stale app.js/style.css. Every local asset reference therefore carries a
// "?v=<hash>" of the calculator's sources; a deploy changes the hash and the
// URLs, so old cached files are never mixed with new ones.
//
// The functions here are pure (text in, text out); stamp-assets.mjs does the I/O.

import { createHash } from "node:crypto";

const VERSION_SUFFIX = /\?v=[0-9a-f]+/g;

// Local (relative, non-URL) asset references. Groups: 1 = text up to and
// including the opening quote, 2 = path, 3 = existing version (if any).
const HTML_REF = /(\b(?:href|src)=")(?![a-z]+:|\/\/)([\w./-]+\.(?:css|js))(?:\?v=([0-9a-f]+))?"/g;
// Relative module specifiers in JS: `from "./x.js"`, `import "./x.js"`, `import("./x.js")`,
// and worker URLs: `new URL("./x.js", import.meta.url)`.
const JS_REF = /((?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\(\s*)")(\.{1,2}\/[\w./-]+\.js)(?:\?v=([0-9a-f]+))?"/g;

const refPattern = (fileName) => (fileName.endsWith(".html") ? HTML_REF : fileName.endsWith(".js") ? JS_REF : null);

/** Remove every "?v=<hash>" so the hash doesn't depend on itself. */
export function stripVersions(text) {
  return text.replace(VERSION_SUFFIX, "");
}

/** Short content hash over { fileName: text }, independent of existing stamps and key order. */
export function computeVersion(files) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    hash.update(name).update("\0").update(stripVersions(files[name])).update("\0");
  }
  return hash.digest("hex").slice(0, 10);
}

/** Rewrite local asset references in an .html or .js file to carry ?v=version. */
export function stampText(fileName, text, version) {
  const pattern = refPattern(fileName);
  return pattern ? text.replace(pattern, (_, lead, path) => `${lead}${path}?v=${version}"`) : text;
}

/** Every local asset reference in a file, with the version it carries (or null). */
export function assetReferences(fileName, text) {
  const pattern = refPattern(fileName);
  return pattern ? [...text.matchAll(pattern)].map((m) => ({ path: m[2], version: m[3] ?? null })) : [];
}
