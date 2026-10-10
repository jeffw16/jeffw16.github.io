// Re-stamp the calculator's asset URLs with a content hash. Run after editing
// any file in coastfire-calculator/:  npm run stamp
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeVersion, stampText } from "./assets.mjs";

export const ASSET_DIR = new URL("../coastfire-calculator/", import.meta.url).pathname;

export function readAssets(dir = ASSET_DIR) {
  const files = {};
  for (const name of readdirSync(dir)) {
    if (/\.(html|css|js)$/.test(name)) files[name] = readFileSync(join(dir, name), "utf8");
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readAssets();
  const version = computeVersion(files);
  for (const [name, text] of Object.entries(files)) {
    const stamped = stampText(name, text, version);
    if (stamped !== text) writeFileSync(join(ASSET_DIR, name), stamped);
  }
  console.log(`Stamped coastfire-calculator assets with v=${version}`);
}
