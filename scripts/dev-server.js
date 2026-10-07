// Local server that behaves like Vercel: serves /public and runs /api/*.js functions.
// Used by the automated tests; you can also run it with real keys:
//   node --env-file=.env.local scripts/dev-server.js   → http://localhost:3000
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
        if (!name || name.startsWith("_")) { res.statusCode = 404; return res.end("Not found"); }
        const file = path.join(ROOT, "api", name + ".js");
        const mod = await import(pathToFileURL(file).href).catch(() => null);
        if (!mod) { res.statusCode = 404; return res.end("Not found"); }
        const chunks = []; for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString("utf8");
        req.query = Object.fromEntries(url.searchParams);
        req.body = /json/.test(req.headers["content-type"] || "") && raw ? JSON.parse(raw) : raw;
        return await mod.default(req, res);
      }
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.join(ROOT, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      const data = await fs.readFile(file);
      res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
      res.end(data);
    } catch (e) {
      res.statusCode = e.code === "ENOENT" ? 404 : 500;
      res.end(res.statusCode === 404 ? "Not found" : "Server error");
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Collab Tracker running at http://localhost:${port}`));
}
