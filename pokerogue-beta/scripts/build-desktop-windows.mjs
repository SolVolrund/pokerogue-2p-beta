import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const rootPath = process.cwd();
const packagePath = path.join(rootPath, "package.json");
const packageJsonText = await readFile(packagePath, "utf8");
const packageJson = JSON.parse(packageJsonText);
const originalVersion = String(packageJson.version ?? "0.0.0");
const desktopVersion = normalizeDesktopVersion(originalVersion);
const electronVersion = getExactDependencyVersion(packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron);
const stageRoot = path.join(rootPath, "desktop-stage");
const appDir = path.join(stageRoot, "app");
const releaseRoot = path.join(rootPath, "desktop-release");
const releaseDir = path.join(releaseRoot, `build-${Date.now()}`);

function normalizeDesktopVersion(version) {
  const parts = version.split(".");
  if (parts.length >= 4 && parts.slice(0, 4).every(part => /^\d+$/.test(part))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}-${parts.slice(3).join(".")}`;
  }

  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) ? version : "0.0.0";
}

function getExactDependencyVersion(version) {
  const exactVersion = String(version ?? "").replace(/^[^\d]*/, "");
  if (/^\d+\.\d+\.\d+/.test(exactVersion)) {
    return exactVersion;
  }

  return "42.5.0";
}

async function createDesktopStage() {
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(path.join(appDir, "scripts"), { recursive: true });
  await mkdir(releaseRoot, { recursive: true });

  await cp(path.join(rootPath, "dist"), path.join(appDir, "dist"), { recursive: true });
  await copyFile(path.join(rootPath, "desktop", "electron", "main.cjs"), path.join(appDir, "main.cjs"));
  await copyFile(path.join(rootPath, "scripts", "two-player-ws-relay.mjs"), path.join(appDir, "scripts", "two-player-ws-relay.mjs"));
  await copyFile(path.join(rootPath, "assets", "logo512.png"), path.join(appDir, "app-icon.png"));

  await writeFile(
    path.join(appDir, "package.json"),
    `${JSON.stringify(
      {
        name: "pokerogue-2p-desktop",
        version: desktopVersion,
        private: true,
        description: "PokeRogue 2P desktop build",
        author: "SolVolrund",
        main: "main.cjs",
        packageManager: "npm@11.9.0",
        dependencies: {},
        devDependencies: {},
        optionalDependencies: {},
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    path.join(appDir, "electron-builder.windows.json"),
    `${JSON.stringify(
      {
        appId: "net.pokerogue.two-player",
        productName: "PokeRogue 2P",
        electronVersion,
        asar: false,
        npmRebuild: false,
        directories: {
          output: releaseDir,
        },
        files: [
          "main.cjs",
          "dist/**/*",
          "scripts/two-player-ws-relay.mjs",
          "app-icon.png",
          "package.json",
        ],
        win: {
          target: ["portable"],
          icon: "app-icon.png",
          verifyUpdateCodeSignature: false,
          signAndEditExecutable: false,
        },
        portable: {
          artifactName: "PokeRogue2P.exe",
        },
      },
      null,
      2,
    )}\n`,
  );
}

let exitCode = 1;

try {
  if (!packageJsonText.includes('"version"')) {
    throw new Error("Root package.json is missing a version field.");
  }

  await createDesktopStage();

  const builderBin = path.resolve("node_modules", "electron-builder", "cli.js");

  const args = [
    "--win",
    "portable",
    "--config",
    "electron-builder.windows.json",
    ...process.argv.slice(2),
  ];

  const child = spawn(process.execPath, [builderBin, ...args], {
    cwd: appDir,
    stdio: "inherit",
    windowsHide: true,
  });

  exitCode = await new Promise(resolve => {
    child.on("exit", code => resolve(code ?? 1));
    child.on("error", error => {
      console.error(error);
      resolve(1);
    });
  });

  if (exitCode === 0) {
    await copyFile(path.join(releaseDir, "PokeRogue2P.exe"), path.join(releaseRoot, "PokeRogue2P.exe"));
  }
} finally {
  await writeFile(packagePath, packageJsonText);
}

process.exit(exitCode);
