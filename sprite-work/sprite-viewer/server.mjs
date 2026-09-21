import { createReadStream } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(toolRoot, "..", "..");
const defaultFrontDir = join(workspaceRoot, "pokerogue-beta", "assets", "images", "pokemon");
const defaultBackDir = join(defaultFrontDir, "back");

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? process.argv[i + 1];
    args.set(key, value);
    if (inlineValue == null) {
      i++;
    }
  }
}

const port = Number(args.get("port") ?? 8787);
const frontDir = resolve(args.get("front") ?? defaultFrontDir);
const backDir = resolve(args.get("back") ?? defaultBackDir);

const mimeTypes = new Map([
  [".png", "image/png"],
  [".json", "application/json; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(body);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function compareNames(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function collectJsonFiles(folder, recursive) {
  const found = [];
  async function visit(current, depth) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < 4 && !entry.name.startsWith(".")) {
          await visit(fullPath, depth + 1);
        }
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        found.push(fullPath);
      }
    }
  }
  await visit(folder, 0);
  return found.sort(compareNames);
}

function getTexture(atlas) {
  if (Array.isArray(atlas?.textures)) {
    return atlas.textures[0];
  }
  if (atlas?.frames && atlas?.meta?.image) {
    return {
      image: atlas.meta.image,
      size: atlas.meta.size,
      frames: Array.isArray(atlas.frames) ? atlas.frames : Object.values(atlas.frames),
    };
  }
  return null;
}

async function describeAtlas(jsonPath, rootFolder) {
  try {
    const text = await readFile(jsonPath, "utf8");
    const atlas = JSON.parse(text);
    const texture = getTexture(atlas);
    if (!texture?.frames?.length) {
      return null;
    }

    const imageName = texture.image ?? jsonPath.replace(/\.json$/i, ".png").split(/[\\/]/).pop();
    const imagePath = resolve(dirname(jsonPath), imageName);
    const imageExists = await exists(imagePath);
    const frameCount = texture.frames.length;
    const uniqueFrames = new Set(
      texture.frames.map(frame => {
        const box = frame.frame ?? {};
        return `${box.x},${box.y},${box.w},${box.h}`;
      }),
    ).size;
    const relativeJson = relative(rootFolder, jsonPath).split(sep).join("/");
    const label = relativeJson.replace(/\.json$/i, "");

    return {
      label,
      jsonPath,
      imagePath,
      imageName,
      imageExists,
      frameCount,
      uniqueFrames,
      canvasSize: texture.size ?? null,
    };
  } catch {
    return null;
  }
}

async function handleList(reqUrl, res) {
  const folder = resolve(reqUrl.searchParams.get("dir") ?? "");
  const recursive = reqUrl.searchParams.get("recursive") === "1";

  try {
    const folderStat = await stat(folder);
    if (!folderStat.isDirectory()) {
      sendJson(res, 400, { error: "That path is not a folder." });
      return;
    }

    const jsonFiles = await collectJsonFiles(folder, recursive);
    const sprites = [];
    for (const jsonPath of jsonFiles) {
      const sprite = await describeAtlas(jsonPath, folder);
      if (sprite) {
        sprites.push(sprite);
      }
    }

    sendJson(res, 200, { folder, recursive, sprites });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleAtlas(reqUrl, res) {
  const jsonPath = resolve(reqUrl.searchParams.get("json") ?? "");
  try {
    const text = await readFile(jsonPath, "utf8");
    const atlas = JSON.parse(text);
    const texture = getTexture(atlas);
    if (!texture?.frames?.length) {
      sendJson(res, 400, { error: "This JSON does not look like a sprite atlas." });
      return;
    }

    const imageName = texture.image ?? jsonPath.replace(/\.json$/i, ".png").split(/[\\/]/).pop();
    const imagePath = resolve(dirname(jsonPath), imageName);
    sendJson(res, 200, {
      jsonPath,
      imagePath,
      imageUrl: `/asset?path=${encodeURIComponent(imagePath)}`,
      atlas,
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleAsset(reqUrl, res) {
  const assetPath = resolve(reqUrl.searchParams.get("path") ?? "");
  const ext = extname(assetPath).toLowerCase();
  if (!mimeTypes.has(ext) || ![".png", ".json"].includes(ext)) {
    sendText(res, 400, "Unsupported asset type.");
    return;
  }

  try {
    await access(assetPath);
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(ext),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    createReadStream(assetPath).pipe(res);
  } catch {
    sendText(res, 404, "Asset not found.");
  }
}

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pokémon Sprite Viewer</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #17191c;
      --panel: #22252a;
      --panel-2: #2b2f36;
      --text: #f1f4f8;
      --muted: #aab3c0;
      --line: #3b414b;
      --accent: #78d7ff;
      --danger: #ff8b8b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      display: grid;
      grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      padding: 16px;
      overflow: auto;
    }
    section {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 100vh;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 20px;
      font-weight: 600;
    }
    label {
      display: grid;
      gap: 6px;
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
    }
    input, select, button {
      font: inherit;
      color: var(--text);
    }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #15171a;
      padding: 8px 10px;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      padding: 8px 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); }
    button[aria-pressed="true"] {
      background: var(--accent);
      color: #061017;
      border-color: var(--accent);
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .mode button { flex: 1; }
    .checks {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 12px 0;
    }
    .checks label {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      color: var(--text);
    }
    .checks input { width: auto; }
    .meta {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      min-height: 38px;
      margin-top: 10px;
    }
    .error {
      color: var(--danger);
      margin-top: 10px;
      font-size: 13px;
      min-height: 18px;
    }
    .toolbar {
      display: flex;
      gap: 12px;
      align-items: end;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .toolbar label { margin: 0; min-width: 120px; }
    .stage-wrap {
      min-width: 0;
      min-height: 0;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .stage {
      display: grid;
      place-items: center;
      width: min(100%, 760px);
      height: min(70vh, 620px);
      border: 1px solid var(--line);
      background-color: #202327;
      background-image:
        linear-gradient(45deg, rgba(255,255,255,.06) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255,255,255,.06) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255,255,255,.06) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.06) 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
      overflow: hidden;
    }
    canvas {
      image-rendering: pixelated;
      max-width: 100%;
      max-height: 100%;
    }
    .status {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 12px 16px;
      border-top: 1px solid var(--line);
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
    }
    .status strong { color: var(--text); font-weight: 600; }
    @media (max-width: 780px) {
      main { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      section { min-height: 560px; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .stage { height: 420px; }
    }
  </style>
</head>
<body>
  <main>
    <aside>
      <h1>Pokémon Sprite Viewer</h1>
      <div class="row mode" role="group" aria-label="Sprite side">
        <button id="frontMode" type="button" aria-pressed="true">Front</button>
        <button id="backMode" type="button" aria-pressed="false">Back</button>
      </div>

      <label>
        Front folder
        <input id="frontDir" spellcheck="false">
      </label>

      <label>
        Back folder
        <input id="backDir" spellcheck="false">
      </label>

      <div class="checks">
        <label><input id="recursive" type="checkbox"> Subfolders</label>
        <label><input id="onion" type="checkbox"> Ghost previous</label>
      </div>

      <button id="scan" type="button">Scan Folder</button>
      <button id="reloadSprite" type="button" style="margin-top: 8px;">Reload Sprite</button>

      <label style="margin-top: 14px;">
        Sprite
        <select id="spriteSelect"></select>
      </label>

      <div id="meta" class="meta"></div>
      <div id="error" class="error" role="status"></div>
    </aside>

    <section>
      <div class="toolbar">
        <div class="row">
          <button id="playPause" type="button">Pause</button>
          <button id="prevFrame" type="button">Previous</button>
          <button id="nextFrame" type="button">Next</button>
          <button id="exportGif" type="button">Export GIF</button>
        </div>
        <div class="row">
          <label>
            FPS
            <input id="fps" type="number" min="1" max="60" value="10">
          </label>
          <label>
            Scale
            <input id="scale" type="number" min="1" max="12" value="4">
          </label>
        </div>
      </div>
      <div class="stage-wrap">
        <div class="stage">
          <canvas id="canvas" width="216" height="216" aria-label="Animated sprite preview"></canvas>
        </div>
      </div>
      <div class="status">
        <span>Frame <strong id="frameInfo">-</strong></span>
        <span>Source <strong id="sourceInfo">-</strong></span>
        <span>Visible box <strong id="boxInfo">-</strong></span>
      </div>
    </section>
  </main>

  <script>
    const state = {
      side: "front",
      sprites: { front: [], back: [] },
      current: null,
      image: null,
      frames: [],
      frameIndex: 0,
      playing: true,
      lastTick: 0,
      accum: 0,
    };

    const els = {
      frontMode: document.getElementById("frontMode"),
      backMode: document.getElementById("backMode"),
      frontDir: document.getElementById("frontDir"),
      backDir: document.getElementById("backDir"),
      recursive: document.getElementById("recursive"),
      onion: document.getElementById("onion"),
      scan: document.getElementById("scan"),
      reloadSprite: document.getElementById("reloadSprite"),
      spriteSelect: document.getElementById("spriteSelect"),
      meta: document.getElementById("meta"),
      error: document.getElementById("error"),
      playPause: document.getElementById("playPause"),
      prevFrame: document.getElementById("prevFrame"),
      nextFrame: document.getElementById("nextFrame"),
      exportGif: document.getElementById("exportGif"),
      fps: document.getElementById("fps"),
      scale: document.getElementById("scale"),
      canvas: document.getElementById("canvas"),
      frameInfo: document.getElementById("frameInfo"),
      sourceInfo: document.getElementById("sourceInfo"),
      boxInfo: document.getElementById("boxInfo"),
    };

    const ctx = els.canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    function setError(message) {
      els.error.textContent = message ?? "";
    }

    function activeDir() {
      return state.side === "front" ? els.frontDir.value : els.backDir.value;
    }

    function textureFromAtlas(atlas) {
      if (Array.isArray(atlas?.textures)) {
        return atlas.textures[0];
      }
      if (atlas?.frames && atlas?.meta?.image) {
        return {
          image: atlas.meta.image,
          size: atlas.meta.size,
          frames: Array.isArray(atlas.frames) ? atlas.frames : Object.values(atlas.frames),
        };
      }
      return null;
    }

    function frameNameValue(frame) {
      return frame.filename ?? frame.name ?? "";
    }

    function sortByGameFrameOrder(frames) {
      return [...frames]
        .filter(frame => frame.frame)
        .map((frame, index) => ({ frame, index, n: Number.parseInt(frameNameValue(frame), 10) }))
        .filter(item => Number.isFinite(item.n) && item.n >= 1 && item.n <= 400)
        .sort((a, b) => a.n - b.n || a.index - b.index)
        .map(item => item.frame);
    }

    function updateModeButtons() {
      els.frontMode.setAttribute("aria-pressed", String(state.side === "front"));
      els.backMode.setAttribute("aria-pressed", String(state.side === "back"));
    }

    async function getJson(url) {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(url + separator + "cacheBust=" + Date.now(), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Request failed.");
      }
      return body;
    }

    async function scan() {
      setError("");
      els.spriteSelect.innerHTML = "";
      els.meta.textContent = "Scanning...";
      const params = new URLSearchParams({
        dir: activeDir(),
        recursive: els.recursive.checked ? "1" : "0",
      });
      try {
        const result = await getJson("/api/list?" + params);
        state.sprites[state.side] = result.sprites;
        for (const sprite of result.sprites) {
          const option = document.createElement("option");
          option.value = sprite.jsonPath;
          option.textContent = sprite.imageExists ? sprite.label : sprite.label + " missing PNG";
          els.spriteSelect.append(option);
        }
        els.meta.textContent = result.sprites.length + " atlas files found in " + state.side + " folder.";
        if (result.sprites.length) {
          const pikachu = result.sprites.find(sprite => /(^|\/)25($|[-_])/.test(sprite.label));
          els.spriteSelect.value = pikachu?.jsonPath ?? result.sprites[0].jsonPath;
          await loadSelected();
        } else {
          clearPreview();
        }
      } catch (error) {
        clearPreview();
        els.meta.textContent = "";
        setError(error.message);
      }
    }

    function clearPreview() {
      state.current = null;
      state.image = null;
      state.frames = [];
      state.frameIndex = 0;
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      els.frameInfo.textContent = "-";
      els.sourceInfo.textContent = "-";
      els.boxInfo.textContent = "-";
    }

    async function loadSelected() {
      const jsonPath = els.spriteSelect.value;
      if (!jsonPath) {
        clearPreview();
        return;
      }
      setError("");
      try {
        const data = await getJson("/api/atlas?json=" + encodeURIComponent(jsonPath));
        const texture = textureFromAtlas(data.atlas);
        const frames = sortByGameFrameOrder(texture.frames);
        if (!frames.length) {
          throw new Error("No numbered animation frames were found.");
        }

        const image = new Image();
        image.decoding = "async";
        image.src = data.imageUrl + "&cacheBust=" + Date.now() + "-" + Math.random().toString(36).slice(2);
        await image.decode();

        state.current = { ...data, texture };
        state.image = image;
        state.frames = frames;
        state.frameIndex = 0;
        state.accum = 0;
        draw();
      } catch (error) {
        clearPreview();
        setError(error.message);
      }
    }

    function canvasSizeFor(frame) {
      const source = frame.sourceSize ?? frame.frame;
      const scale = Math.max(1, Number(els.scale.value) || 1);
      return {
        w: Math.max(1, source.w * scale),
        h: Math.max(1, source.h * scale),
        scale,
      };
    }

    function drawFrame(frame, opacity) {
      const scaleInfo = canvasSizeFor(frame);
      const src = frame.frame;
      const offset = frame.spriteSourceSize ?? { x: 0, y: 0, w: src.w, h: src.h };
      ctx.globalAlpha = opacity;
      ctx.drawImage(
        state.image,
        src.x, src.y, src.w, src.h,
        offset.x * scaleInfo.scale,
        offset.y * scaleInfo.scale,
        src.w * scaleInfo.scale,
        src.h * scaleInfo.scale,
      );
      ctx.globalAlpha = 1;
    }

    function draw() {
      if (!state.image || !state.frames.length) {
        return;
      }

      const frame = state.frames[state.frameIndex];
      const size = canvasSizeFor(frame);
      if (els.canvas.width !== size.w || els.canvas.height !== size.h) {
        els.canvas.width = size.w;
        els.canvas.height = size.h;
        ctx.imageSmoothingEnabled = false;
      }
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

      if (els.onion.checked && state.frames.length > 1) {
        const previous = state.frames[(state.frameIndex - 1 + state.frames.length) % state.frames.length];
        drawFrame(previous, 0.28);
      }
      drawFrame(frame, 1);

      const source = frame.sourceSize ?? frame.frame;
      const box = frame.frame;
      els.frameInfo.textContent = (state.frameIndex + 1) + "/" + state.frames.length + " (" + frameNameValue(frame) + ")";
      els.sourceInfo.textContent = source.w + "x" + source.h;
      els.boxInfo.textContent = box.x + "," + box.y + "," + box.w + "," + box.h;
    }

    function step(delta) {
      if (!state.frames.length) {
        return;
      }
      state.frameIndex = (state.frameIndex + delta + state.frames.length) % state.frames.length;
      draw();
    }

    function writeAscii(bytes, text) {
      for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i) & 255);
      }
    }

    function writeShort(bytes, value) {
      bytes.push(value & 255, (value >> 8) & 255);
    }

    function nextPowerOfTwo(value) {
      let power = 1;
      while (power < value) {
        power <<= 1;
      }
      return Math.max(2, Math.min(256, power));
    }

    function paletteBits(tableSize) {
      return Math.max(1, Math.ceil(Math.log2(tableSize)));
    }

    function quantizedIndex(r, g, b) {
      const ri = Math.min(6, Math.floor(r / 37));
      const gi = Math.min(5, Math.floor(g / 43));
      const bi = Math.min(5, Math.floor(b / 43));
      return 1 + ri * 36 + gi * 6 + bi;
    }

    function quantizedColor(index) {
      const value = index - 1;
      const ri = Math.floor(value / 36);
      const gi = Math.floor((value % 36) / 6);
      const bi = value % 6;
      return [
        Math.round((ri / 6) * 255),
        Math.round((gi / 5) * 255),
        Math.round((bi / 5) * 255),
      ];
    }

    function buildIndexedFrame(imageData) {
      const rgba = imageData.data;
      const exact = new Map();
      const exactColors = [[0, 0, 0]];
      let overflow = false;

      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < 128) {
          continue;
        }
        const key = rgba[i] + "," + rgba[i + 1] + "," + rgba[i + 2];
        if (!exact.has(key)) {
          if (exactColors.length >= 256) {
            overflow = true;
            break;
          }
          exact.set(key, exactColors.length);
          exactColors.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
        }
      }

      const indices = new Uint8Array(imageData.width * imageData.height);
      let colors = exactColors;

      if (overflow) {
        colors = [[0, 0, 0]];
        for (let i = 1; i <= 252; i++) {
          colors[i] = quantizedColor(i);
        }
        for (let pixel = 0, i = 0; i < rgba.length; i += 4, pixel++) {
          indices[pixel] = rgba[i + 3] < 128 ? 0 : quantizedIndex(rgba[i], rgba[i + 1], rgba[i + 2]);
        }
      } else {
        for (let pixel = 0, i = 0; i < rgba.length; i += 4, pixel++) {
          if (rgba[i + 3] < 128) {
            indices[pixel] = 0;
          } else {
            indices[pixel] = exact.get(rgba[i] + "," + rgba[i + 1] + "," + rgba[i + 2]);
          }
        }
      }

      const tableSize = nextPowerOfTwo(colors.length);
      while (colors.length < tableSize) {
        colors.push([0, 0, 0]);
      }
      return { indices, colors, tableSize };
    }

    function lzwEncode(indices, minCodeSize) {
      const clearCode = 1 << minCodeSize;
      const endCode = clearCode + 1;
      let codeSize = minCodeSize + 1;
      const bytes = [];
      let current = 0;
      let bits = 0;

      function writeCode(code) {
        current |= code << bits;
        bits += codeSize;
        while (bits >= 8) {
          bytes.push(current & 255);
          current >>= 8;
          bits -= 8;
        }
      }

      writeCode(clearCode);
      for (let i = 0; i < indices.length; i++) {
        writeCode(indices[i]);
        if (i !== indices.length - 1) {
          writeCode(clearCode);
        }
      }
      writeCode(endCode);
      if (bits > 0) {
        bytes.push(current & 255);
      }
      return bytes;
    }

    function writeDataBlocks(bytes, data) {
      for (let i = 0; i < data.length; i += 255) {
        const chunk = data.slice(i, i + 255);
        bytes.push(chunk.length, ...chunk);
      }
      bytes.push(0);
    }

    function renderExportFrame(frame, width, height, scale) {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = width;
      exportCanvas.height = height;
      const exportCtx = exportCanvas.getContext("2d");
      exportCtx.imageSmoothingEnabled = false;
      exportCtx.clearRect(0, 0, width, height);
      const src = frame.frame;
      const offset = frame.spriteSourceSize ?? { x: 0, y: 0 };
      exportCtx.drawImage(
        state.image,
        src.x, src.y, src.w, src.h,
        offset.x * scale,
        offset.y * scale,
        src.w * scale,
        src.h * scale,
      );
      return exportCtx.getImageData(0, 0, width, height);
    }

    function createGifBlob(frames, width, height, fps, scale) {
      const bytes = [];
      const delay = Math.max(2, Math.round(100 / fps));
      writeAscii(bytes, "GIF89a");
      writeShort(bytes, width);
      writeShort(bytes, height);
      bytes.push(0, 0, 0);
      bytes.push(33, 255, 11);
      writeAscii(bytes, "NETSCAPE2.0");
      bytes.push(3, 1);
      writeShort(bytes, 0);
      bytes.push(0);

      for (const frame of frames) {
        const imageData = renderExportFrame(frame, width, height, scale);
        const indexed = buildIndexedFrame(imageData);
        const bits = paletteBits(indexed.tableSize);
        const minCodeSize = Math.max(2, bits);
        const imageDataBytes = lzwEncode(indexed.indices, minCodeSize);

        bytes.push(33, 249, 4, 9);
        writeShort(bytes, delay);
        bytes.push(0, 0);

        bytes.push(44);
        writeShort(bytes, 0);
        writeShort(bytes, 0);
        writeShort(bytes, width);
        writeShort(bytes, height);
        bytes.push(128 | ((bits - 1) & 7));
        for (const color of indexed.colors) {
          bytes.push(color[0], color[1], color[2]);
        }
        bytes.push(minCodeSize);
        writeDataBlocks(bytes, imageDataBytes);
      }

      bytes.push(59);
      return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
    }

    async function exportGif() {
      if (!state.image || !state.frames.length) {
        setError("Pick a sprite before exporting.");
        return;
      }
      setError("");
      const oldText = els.exportGif.textContent;
      els.exportGif.disabled = true;
      els.exportGif.textContent = "Exporting...";
      try {
        await new Promise(resolve => setTimeout(resolve, 20));
        const first = state.frames[0];
        const source = first.sourceSize ?? first.frame;
        const scale = Math.max(1, Number(els.scale.value) || 1);
        const fps = Math.min(60, Math.max(1, Number(els.fps.value) || 10));
        const blob = createGifBlob(state.frames, source.w * scale, source.h * scale, fps, scale);
        const selected = els.spriteSelect.selectedOptions[0]?.textContent ?? "pokemon-sprite";
        const cleanName = selected.replace(/\s+missing PNG$/, "").replace(/[^a-z0-9._-]+/gi, "-");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = cleanName + ".gif";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        setError(error.message);
      } finally {
        els.exportGif.disabled = false;
        els.exportGif.textContent = oldText;
      }
    }

    function loop(timestamp) {
      if (!state.lastTick) {
        state.lastTick = timestamp;
      }
      const elapsed = timestamp - state.lastTick;
      state.lastTick = timestamp;
      if (state.playing && state.frames.length) {
        state.accum += elapsed;
        const fps = Math.min(60, Math.max(1, Number(els.fps.value) || 10));
        const frameMs = 1000 / fps;
        while (state.accum >= frameMs) {
          state.accum -= frameMs;
          state.frameIndex = (state.frameIndex + 1) % state.frames.length;
        }
        draw();
      }
      requestAnimationFrame(loop);
    }

    function setSide(side) {
      state.side = side;
      updateModeButtons();
      scan();
    }

    els.frontMode.addEventListener("click", () => setSide("front"));
    els.backMode.addEventListener("click", () => setSide("back"));
    els.scan.addEventListener("click", scan);
    els.reloadSprite.addEventListener("click", loadSelected);
    els.spriteSelect.addEventListener("change", loadSelected);
    els.playPause.addEventListener("click", () => {
      state.playing = !state.playing;
      els.playPause.textContent = state.playing ? "Pause" : "Play";
    });
    els.prevFrame.addEventListener("click", () => step(-1));
    els.nextFrame.addEventListener("click", () => step(1));
    els.exportGif.addEventListener("click", exportGif);
    els.scale.addEventListener("input", draw);
    els.onion.addEventListener("change", draw);

    window.addEventListener("keydown", event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        els.playPause.click();
      } else if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      }
    });

    getJson("/api/defaults").then(defaults => {
      els.frontDir.value = defaults.frontDir;
      els.backDir.value = defaults.backDir;
      updateModeButtons();
      scan();
      requestAnimationFrame(loop);
    }).catch(error => {
      setError(error.message);
    });
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (reqUrl.pathname === "/") {
    sendText(res, 200, html, "text/html; charset=utf-8");
    return;
  }
  if (reqUrl.pathname === "/api/defaults") {
    sendJson(res, 200, { frontDir, backDir });
    return;
  }
  if (reqUrl.pathname === "/api/list") {
    await handleList(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === "/api/atlas") {
    await handleAtlas(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === "/asset") {
    await handleAsset(reqUrl, res);
    return;
  }
  sendText(res, 404, "Not found.");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sprite viewer running at http://127.0.0.1:${port}`);
  console.log(`Front folder: ${frontDir}`);
  console.log(`Back folder:  ${backDir}`);
});
