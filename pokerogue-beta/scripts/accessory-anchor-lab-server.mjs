import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const toolsRoot = path.join(repoRoot, "tools");
const saveRoot = path.join(toolsRoot, "accessory-anchor-json");
const gameAnchorRoot = path.join(repoRoot, "assets", "images", "pokemon", "accessory-anchors");
const gameAccessoryRoot = path.join(repoRoot, "assets", "images", "pokemon", "accessories");
const gameAccessorySheetFileName = "accessories.png";
const gameAccessoryManifestFileName = "accessories.json";
const gameAnchorManifestFileName = "_manifest.json";
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

function gamePokemonAnchorPath(pokemonKey, spriteSource) {
  const fileName = safePokemonFileName(pokemonKey, spriteSource);
  return fileName ? path.join(gameAnchorRoot, fileName) : null;
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

function requireLabSchema(json) {
  if (json?.schema !== "pokemon-accessory-anchor-lab-v1") {
    throw new Error("JSON does not use the accessory anchor lab schema.");
  }
}

function normalizeAnchorsBySide(json) {
  if (json?.anchorsBySide && typeof json.anchorsBySide === "object") {
    return json.anchorsBySide;
  }
  const side = json?.pokemon?.side === "back" ? "back" : "front";
  return {
    front: {},
    back: {},
    [side]: json?.anchors ?? {},
  };
}

function decodeDataUrl(dataUrl) {
  if (!dataUrl) {
    return null;
  }
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Accessory sheet data URL is invalid.");
  }
  return Buffer.from(match[2], "base64");
}

async function writeGameAnchorManifest() {
  await mkdir(gameAnchorRoot, { recursive: true });
  const files = (await readdir(gameAnchorRoot))
    .filter(fileName => fileName.endsWith(".json") && fileName !== gameAnchorManifestFileName)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const manifestPath = path.join(gameAnchorRoot, gameAnchorManifestFileName);
  await writeFile(`${manifestPath}`, `${JSON.stringify({ files }, null, 2)}\n`, "utf8");
  return manifestPath;
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
      requireLabSchema(json);
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

async function handleGameAssetExportApi(request, response) {
  if (request.method !== "PUT" && request.method !== "POST") {
    sendJson(response, 405, { error: "Unsupported accessory game asset export request." });
    return;
  }

  try {
    const body = await requestBody(request);
    const json = JSON.parse(body);
    requireLabSchema(json);

    const exportTarget = json.exportTarget === "accessories" ? "accessories" : "anchors";
    const exportedPaths = [];

    if (exportTarget === "accessories") {
      const sheetBuffer = decodeDataUrl(json.accessorySheet?.dataUrl);
      const sheetPath = path.join(gameAccessoryRoot, gameAccessorySheetFileName);
      const accessoryManifestPath = path.join(gameAccessoryRoot, gameAccessoryManifestFileName);

      if (!sheetBuffer && !Array.isArray(json.accessories)) {
        sendJson(response, 400, { error: "Accessory export requires an accessory sheet or accessory definitions." });
        return;
      }

      await mkdir(gameAccessoryRoot, { recursive: true });
      if (sheetBuffer) {
        await writeFile(sheetPath, sheetBuffer);
        exportedPaths.push(path.relative(repoRoot, sheetPath).replaceAll(path.sep, "/"));
      }

      const accessoryExport = {
        schema: "pokemon-accessory-catalog-v1",
        sheet: {
          imageName: gameAccessorySheetFileName,
          width: json.accessorySheet?.width ?? null,
          height: json.accessorySheet?.height ?? null,
        },
        slots: Array.isArray(json.slots) ? json.slots : [],
        accessories: Array.isArray(json.accessories)
          ? json.accessories.map(accessory => ({
              id: accessory.id,
              name: accessory.name,
              style: accessory.style ?? "",
              slots: Array.isArray(accessory.slots) ? accessory.slots : [],
              sourceImageName: accessory.sourceImageName ?? "",
              rect: accessory.rect,
              pivot: accessory.pivot,
            }))
          : [],
      };
      await writeFile(accessoryManifestPath, `${JSON.stringify(accessoryExport, null, 2)}\n`, "utf8");
      exportedPaths.push(path.relative(repoRoot, accessoryManifestPath).replaceAll(path.sep, "/"));

      sendJson(response, 200, {
        exported: true,
        paths: exportedPaths,
      });
      return;
    }

    const pokemonKey = String(json?.pokemon?.key ?? "").trim();
    const spriteSource = String(json?.pokemon?.source ?? "base").trim();
    const anchorPath = gamePokemonAnchorPath(pokemonKey, spriteSource);
    if (!anchorPath) {
      sendJson(response, 400, { error: "A valid pokemon key is required before exporting anchors." });
      return;
    }

    const anchorExport = {
      schema: "pokemon-accessory-anchors-v1",
      pokemon: {
        key: pokemonKey,
        source: spriteSource || "base",
        imageName: json.pokemon?.imageName ?? "",
        frameCount: json.pokemon?.frameCount ?? 0,
        frameSize: json.pokemon?.frameSize ?? null,
      },
      slots: Array.isArray(json.slots) ? json.slots : [],
      anchorsBySide: normalizeAnchorsBySide(json),
    };

    await mkdir(gameAnchorRoot, { recursive: true });
    await writeFile(anchorPath, `${JSON.stringify(anchorExport, null, 2)}\n`, "utf8");
    exportedPaths.push(path.relative(repoRoot, anchorPath).replaceAll(path.sep, "/"));
    const manifestPath = await writeGameAnchorManifest();
    exportedPaths.push(path.relative(repoRoot, manifestPath).replaceAll(path.sep, "/"));

    sendJson(response, 200, {
      exported: true,
      paths: exportedPaths,
    });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
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
  if (url.pathname === "/api/accessory-game-assets") {
    void handleGameAssetExportApi(request, response);
    return;
  }
  void serveStatic(request, response, url);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pokemon accessory anchor lab: http://127.0.0.1:${port}/tools/pokemon-accessory-anchor-lab.html`);
  console.log(`Saving JSON files to ${path.relative(repoRoot, saveRoot).replaceAll(path.sep, "/")}/`);
  console.log(`Exporting game assets to ${path.relative(repoRoot, gameAnchorRoot).replaceAll(path.sep, "/")}/ and ${path.relative(repoRoot, gameAccessoryRoot).replaceAll(path.sep, "/")}/`);
});
