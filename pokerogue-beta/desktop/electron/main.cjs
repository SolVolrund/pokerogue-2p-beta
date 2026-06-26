const { app, BrowserWindow, shell } = require("electron");
const { createReadStream, existsSync, statSync } = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_GAME_HOST = process.env.POKEROGUE_2P_APP_HOST || "0.0.0.0";
const DEFAULT_GAME_PORT = Number.parseInt(process.env.POKEROGUE_2P_APP_PORT || "8000", 10);
const DEFAULT_RELAY_HOST = process.env.POKEROGUE_2P_WS_HOST || "0.0.0.0";
const DEFAULT_RELAY_PORT = process.env.POKEROGUE_2P_WS_PORT || "8787";

let mainWindow;
let staticServer;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".wav": "audio/wav",
};

function getAppRoot() {
  return app.getAppPath();
}

function getDistPath() {
  return path.join(getAppRoot(), "dist");
}

function getRelayPath() {
  return path.join(getAppRoot(), "scripts", "two-player-ws-relay.mjs");
}

function resolveStaticPath(requestUrl) {
  const distPath = getDistPath();
  const url = new URL(requestUrl, "http://127.0.0.1");
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = path.normalize(path.join(distPath, decodedPath));
  const relativePath = path.relative(distPath, requestedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    return requestedPath;
  }

  if (path.extname(requestedPath)) {
    return undefined;
  }

  return path.join(distPath, "index.html");
}

function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const filePath = resolveStaticPath(request.url || "/");
      if (!filePath || !existsSync(filePath)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, { "content-type": contentType });
      createReadStream(filePath).pipe(response);
    });

    server.once("error", error => {
      if (error.code === "EADDRINUSE" && port < DEFAULT_GAME_PORT + 20) {
        startStaticServer(port + 1).then(resolve, reject);
        return;
      }

      reject(error);
    });

    server.listen(port, DEFAULT_GAME_HOST, () => {
      resolve({ server, port });
    });
  });
}

async function startRelayServer() {
  process.env.POKEROGUE_2P_WS_HOST = DEFAULT_RELAY_HOST;
  process.env.POKEROGUE_2P_WS_PORT = DEFAULT_RELAY_PORT;

  const relayPath = getRelayPath();
  if (!existsSync(relayPath)) {
    console.warn(`[desktop] Two-player relay script missing at ${relayPath}`);
    return;
  }

  await import(pathToFileURL(relayPath).href);
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: "#000000",
    icon: path.join(getAppRoot(), "app-icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  if (process.env.DEBUG) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  const { server, port } = await startStaticServer(DEFAULT_GAME_PORT);
  staticServer = server;
  startRelayServer().catch(error => {
    console.warn(`[desktop] Failed to start two-player relay: ${error.message}`);
  });
  await createWindow(port);
});

app.on("window-all-closed", () => {
  staticServer?.close();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && staticServer?.address()) {
    const address = staticServer.address();
    createWindow(typeof address === "object" && address ? address.port : DEFAULT_GAME_PORT);
  }
});
