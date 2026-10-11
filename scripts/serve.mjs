// Dependency-free static file server for local development and the e2e tests:
//   npm run serve   (PORT=8765 by default)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Absolute file path for a request URL path, or null if it escapes ROOT. */
export function resolvePath(urlPath, root = ROOT) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const full = normalize(join(root, decoded));
  const base = root.endsWith(sep) ? root : root + sep;
  return (full + sep).startsWith(base) ? full : null;
}

export function createStaticServer(root = ROOT) {
  return createServer(async (req, res) => {
    let file = resolvePath(req.url ?? "/", root);
    if (!file) { res.writeHead(403).end("Forbidden"); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8765);
  createStaticServer().listen(port, () => console.log(`Serving ${ROOT} on http://localhost:${port}/`));
}
