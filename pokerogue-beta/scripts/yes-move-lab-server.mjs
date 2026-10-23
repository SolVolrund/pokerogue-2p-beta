// Read-only localhost server for the standalone Yes Move Lab.
import { createServer } from "node:http";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../tools/yes-move-renderer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderer = globalThis.YesMoveRenderer;
const slug = name => name.toLowerCase().replace(/_+/g, "-");
export async function buildCatalog() {
  const [enumSource, zSource, files] = await Promise.all([
    readFile(path.join(root, "src/enums/move-id.ts"), "utf8"),
    readFile(path.join(root, "src/utils/z-move-utils.ts"), "utf8"),
    readdir(path.join(root, "assets/battle-anims")),
  ]);
  const names = new Set([...enumSource.matchAll(/^\s+([A-Z][A-Z0-9_]*)(?:\s*=\s*\d+)?,/gm)].map(m => slug(m[1])));
  const zNames = new Set([...zSource.matchAll(/(?:physical|special|zMove): MoveId\.([A-Z0-9_]+)/g)].map(m => slug(m[1])));
  const moves = [], errors = [];
  // Read sequentially to keep catalogue initialization bounded on large asset trees.
  for (const file of files) {
    const key = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !names.has(key)) continue;
    try {
      const variants = renderer.configs(JSON.parse(await readFile(path.join(root, "assets/battle-anims", file), "utf8")));
      if (!variants.length || !variants.some(c => c.frames.length)) continue;
      moves.push({ key, name: key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        zMove: zNames.has(key), variants: variants.length,
        frames: Math.max(...variants.map(c => c.frames.length)),
        durationFrames: Math.max(...variants.map(renderer.visualFrames)),
        backgrounds: variants.some(c => renderer.events(c).some(e => e.eventType === "AnimTimedAddBgEvent")),
        effects: variants.some(c => c.frames.some(frames => frames.some(f => f.target === 2 && f.visible && f.opacity))) });
    } catch (error) { errors.push(`${key}: ${error.message}`); }
  }
  moves.sort((a, b) => b.durationFrames - a.durationFrames || a.name.localeCompare(b.name));
  return { moves, errors, fps: renderer.FPS };
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4" };
export function createLabServer() {
  let catalog;
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/") {
        response.writeHead(302, { Location: "/tools/yes-move-lab.html" }); response.end(); return;
      }
      if (pathname === "/api/moves") {
        catalog ||= buildCatalog().catch(error => { catalog = null; throw error; });
        const body = JSON.stringify(await catalog);
        response.writeHead(200, { "Content-Type": mime[".json"], "Cache-Control": "no-store" });
        response.end(request.method === "HEAD" ? undefined : body); return;
      }
      const relative = pathname.slice(1);
      // Only expose the lab and its animation, graphics and sound assets.
      const allowed = /^tools\/yes-move-(?:lab\.html|lab\.js|renderer\.js|audio\.js|audio-engine\.js|video\.js)$/.test(relative)
        || /^assets\/(?:battle-anims\/[^/\\]+\.json|images\/battle_anims\/[^/\\]+\.png|audio\/battle_anims\/[^/\\]+\.(?:wav|ogg|mp3|m4a)|audio\/cry\/151\.m4a)$/.test(relative);
      if (!allowed) { response.writeHead(404); response.end("Not found"); return; }
      const file = await realpath(path.resolve(root, relative));
      const within = path.relative(root, file);
      if (within.startsWith("..") || path.isAbsolute(within)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain" });
      response.end(error.code === "ENOENT" ? "Asset not found" : "Unable to read local assets.");
      if (error.code !== "ENOENT") console.error(error);
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.YES_MOVE_LAB_PORT || 8792);
  const server = createLabServer();
  server.on("error", error => { console.error(`Yes Move Lab: ${error.message}`); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Yes Move Lab: http://127.0.0.1:${port}\nRead-only asset server. Ctrl+C to stop.`));
}
