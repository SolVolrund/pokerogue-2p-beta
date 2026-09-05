import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const toolsRoot = path.join(repoRoot, "tools");
const saveRoot = path.join(toolsRoot, "accessory-anchor-json");
const port = Number(process.env.PORT || 8789);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function safePokemonFileName(pokemonKey, spriteSource) {
  const key = String(pokemonKey ?? "").trim();
  if (!key || !/^[\w.-]+$/.test(key)) {
    return null;
  }
  const source = String(spriteSource ?? "base").trim();
  if (!source || source === "base") {
    return `${key}.json`;
  }
  if (!/^[\w.-]+$/.test(source)) {
    return null;
  }
  return `${key}-${source}.json`;
}

function pokemonJsonPath(searchParams) {
  const fileName = safePokemonFileName(searchParams.get("pokemonKey"), searchParams.get("spriteSource"));
  return fileName ? path.join(saveRoot, fileName) : null;
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 5_000_000) {
        request.destroy(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function handleJsonApi(request, response, url) {
  const filePath = pokemonJsonPath(url.searchParams);
  const fileName = filePath ? path.basename(filePath) : "";
  if (!filePath) {
    sendJson(response, 400, { error: "A valid pokemonKey query parameter is required." });
    return;
  }

  if (url.pathname === "/api/accessory-anchor-json/status" && request.method === "GET") {
    try {
      await stat(filePath);
      sendJson(response, 200, {
        exists: true,
        fileName,
        path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      });
    } catch {
      sendJson(response, 200, {
        exists: false,
        fileName,
        path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      });
    }
    return;
  }

  if (url.pathname === "/api/accessory-anchor-json" && request.method === "GET") {
    try {
      const body = await readFile(filePath, "utf8");
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      sendJson(response, 404, { error: `${fileName} has not been created yet.` });
    }
    return;
  }

  if (url.pathname === "/api/accessory-anchor-json" && (request.method === "PUT" || request.method === "POST")) {
    try {
      const body = await requestBody(request);
      const json = JSON.parse(body);
      if (json?.schema !== "pokemon-accessory-anchor-lab-v1") {
        sendJson(response, 400, { error: "JSON does not use the accessory anchor lab schema." });
        return;
      }
      await mkdir(saveRoot, { recursive: true });
      await writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      sendJson(response, 200, {
        saved: true,
        fileName,
        path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(response, 405, { error: "Unsupported accessory anchor JSON API request." });
}

function staticFilePath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const relativePath = withoutLeadingSlash || "tools/pokemon-accessory-anchor-lab.html";
  const filePath = path.resolve(repoRoot, relativePath);
  if (!filePath.startsWith(repoRoot + path.sep)) {
    return null;
  }
  return filePath;
}

async function serveStatic(request, response, url) {
  const filePath = staticFilePath(url.pathname);
  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  if (url.pathname.startsWith("/api/accessory-anchor-json")) {
    void handleJsonApi(request, response, url);
    return;
  }
  void serveStatic(request, response, url);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pokemon accessory anchor lab: http://127.0.0.1:${port}/tools/pokemon-accessory-anchor-lab.html`);
  console.log(`Saving JSON files to ${path.relative(repoRoot, saveRoot).replaceAll(path.sep, "/")}/`);
});
