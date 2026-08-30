import { globalScene } from "#app/global-scene";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { variantColorCache } from "#sprites/variant";
import { cachedFetch, getCachedUrl } from "#utils/fetch-utils";

type Rgba = readonly [number, number, number, number];
type Point = { x: number; y: number };
type Transform = { origin: Point; xAxis: Point; yAxis: Point };
type AntiWigglePixels = { localCells: Set<string>; headOffsets: Point[] };
type Anchors = {
  headCenter: Point;
  nose: Point;
  leftEarTip: Point;
  leftEarRoot: Point;
  rightEarTip: Point;
  rightEarRoot: Point;
};
type AtlasFrame = {
  filename: string;
  rotated?: boolean;
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  frame: { x: number; y: number; w: number; h: number };
};
type Atlas = { textures: [{ size: { w: number; h: number }; frames: AtlasFrame[] }] };
type AnchorValues = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const SPINDA_ASSET_ROOT = "./images/pokemon/spinda";
const NORMAL_SPOT_COLOR: Rgba = [239, 82, 74, 255];
const ANTI_WIGGLE_COLOR = "00ff28ff";
const ANTI_WIGGLE_BRIDGE_COLOR = "00ffdcff";

const BODY_COLOR_MAPS: Record<string, ReadonlyMap<string, Rgba>> = {
  normal: new Map<string, Rgba>([
    ["eee1bdff", [241, 109, 102, 255]],
    ["ede1bdff", [241, 109, 102, 255]],
    ["e6d6a5ff", [239, 82, 74, 255]],
    ["cea573ff", [189, 74, 49, 255]],
  ]),
  shiny: new Map<string, Rgba>([
    ["eee1bdff", [188, 234, 18, 255]],
    ["ede1bdff", [188, 234, 18, 255]],
    ["e6d6a5ff", [165, 206, 16, 255]],
    ["cea573ff", [123, 156, 0, 255]],
  ]),
};

const SPOTS = [
  { region: "leftEar", base: { x: 8, y: -1 }, mask: 0 },
  { region: "rightEar", base: { x: 8, y: 1 }, mask: 1 },
  { region: "head", base: { x: -8, y: 1 }, mask: 2 },
  { region: "head", base: { x: 5, y: 2 }, mask: 3 },
] as const;

const POSE_ANCHORS: Record<string, AnchorValues> = {
  "0:51:36:51:3:0:36:51:39:51:0": [20, 23, 18, 27, 9, 6, 13, 13, 34, 7, 29, 14],
  "37:0:36:51:3:0:36:51:39:51:0": [20, 23, 18, 27, 11, 6, 14, 13, 33, 7, 29, 14],
  "72:51:35:51:4:0:35:51:39:51:0": [21, 23, 19, 27, 13, 5, 16, 13, 33, 6, 30, 14],
  "109:0:35:51:4:0:35:51:39:51:0": [22, 23, 20, 27, 16, 5, 17, 13, 33, 5, 31, 13],
  "72:102:35:51:4:0:35:51:39:51:0": [22, 23, 20, 27, 13, 5, 15, 13, 33, 6, 29, 14],
  "0:102:36:51:3:0:36:51:39:51:0": [20, 23, 18, 27, 9, 6, 13, 13, 34, 7, 29, 14],
  "0:0:37:51:2:0:37:51:39:51:0": [19, 23, 17, 27, 8, 6, 12, 13, 33, 7, 28, 14],
  "36:51:36:51:2:0:36:51:39:51:0": [18, 23, 16, 27, 7, 6, 11, 13, 32, 7, 27, 14],
  "73:0:36:51:3:0:36:51:39:51:0": [20, 23, 18, 27, 9, 6, 13, 13, 34, 7, 29, 14],
  "36:102:36:51:3:0:36:51:39:51:0": [19, 23, 17, 27, 8, 6, 12, 13, 33, 7, 28, 14],
  "107:51:36:50:3:1:36:50:39:51:0": [19, 24, 17, 28, 8, 7, 12, 14, 33, 8, 28, 15],
  "144:0:36:50:2:1:36:50:39:51:0": [18, 24, 16, 28, 7, 7, 11, 14, 32, 8, 27, 15],
  "107:101:36:50:1:1:36:50:39:51:0": [17, 24, 15, 28, 6, 7, 10, 14, 31, 8, 26, 15],
  "143:51:36:49:1:2:36:49:39:51:0": [17, 25, 15, 29, 6, 8, 10, 15, 31, 9, 26, 16],
  "143:100:36:49:0:2:36:49:39:51:0": [16, 25, 14, 29, 5, 8, 9, 15, 30, 9, 25, 16],
  "143:149:35:48:0:3:35:48:39:51:0": [15, 26, 13, 30, 4, 9, 8, 16, 29, 10, 24, 17],
};

const SPOT_MASKS = [
  spotMask(12, [
    [1, 4, 5],
    [1, 2, 3],
    [1, 1, 2],
    [1, 1, 1],
    [1, 0, 1],
    [3, 0, 0],
    [2, 1, 1],
    [1, 2, 2],
    [1, 4, 3],
  ]),
  spotMask(13, [
    [1, 5, 4],
    [1, 3, 3],
    [1, 2, 2],
    [2, 1, 1],
    [3, 0, 0],
    [2, 1, 1],
    [1, 2, 2],
    [1, 3, 2],
    [1, 5, 5],
  ]),
  spotMask(7, [
    [1, 2, 2],
    [1, 1, 1],
    [5, 0, 0],
    [1, 1, 1],
    [1, 2, 2],
  ]),
  spotMask(8, [
    [1, 2, 2],
    [1, 1, 1],
    [5, 0, 0],
    [1, 1, 1],
    [1, 2, 2],
  ]),
];

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const atlasCache = new Map<string, Promise<Atlas>>();
const textureGenerationCache = new Map<string, Promise<string | null>>();

export function getSpindaSpotTextureKey(pokemon: Pokemon, baseBattleSpriteKey: string): string | null {
  if (!isSpindaSpotEligible(pokemon, baseBattleSpriteKey)) {
    return null;
  }

  const personality = pokemon.id.toString(16).padStart(8, "0");
  const variant = pokemon.shiny ? `s${pokemon.variant}` : "n";
  return `${baseBattleSpriteKey}__spots__${personality}__${variant}`;
}

export function getLoadedSpindaSpotTextureKey(pokemon: Pokemon, baseBattleSpriteKey: string): string | null {
  const key = getSpindaSpotTextureKey(pokemon, baseBattleSpriteKey);
  return key && globalScene.textures.exists(key) ? key : null;
}

export async function ensureSpindaSpotTexture(
  pokemon: Pokemon,
  baseBattleSpriteKey: string,
  atlasPath: string,
): Promise<string | null> {
  const key = getSpindaSpotTextureKey(pokemon, baseBattleSpriteKey);
  if (!key) {
    return null;
  }
  if (globalScene.textures.exists(key)) {
    ensureSpindaSpotAnimation(key);
    return key;
  }
  const pendingTexture = textureGenerationCache.get(key);
  if (pendingTexture) {
    return pendingTexture;
  }

  const generatedTexture = generateSpindaSpotTexture(pokemon, baseBattleSpriteKey, atlasPath, key);
  textureGenerationCache.set(key, generatedTexture);
  return generatedTexture.finally(() => textureGenerationCache.delete(key));
}

async function generateSpindaSpotTexture(
  pokemon: Pokemon,
  baseBattleSpriteKey: string,
  atlasPath: string,
  key: string,
): Promise<string | null> {
  try {
    const palette = pokemon.shiny && pokemon.variant === 0 ? "shiny" : "normal";
    const [atlas, baseImage, faceImage, maskImage, antiWiggleImage] = await Promise.all([
      loadAtlas(atlasPath),
      loadImage(`${SPINDA_ASSET_ROOT}/${palette === "shiny" ? "shiny/" : ""}327-clean.png`),
      loadImage(`${SPINDA_ASSET_ROOT}/${palette === "shiny" ? "shiny/" : ""}327-face.png`),
      loadImage(`${SPINDA_ASSET_ROOT}/327-mask.png`),
      loadImage(`${SPINDA_ASSET_ROOT}/327-anti-wiggle-mask.png`),
    ]);
    const canvas = composeSpindaAtlas(atlas, baseImage, faceImage, maskImage, antiWiggleImage, pokemon.id, palette);
    const texture = globalScene.textures.addCanvas(key, canvas);
    if (!texture) {
      throw new Error(`Could not create generated Spinda texture ${key}`);
    }
    globalScene.textures.addAtlas(key, texture, atlas);
    copyVariantColorCache(baseBattleSpriteKey, key);
    ensureSpindaSpotAnimation(key);
    return key;
  } catch (error) {
    console.warn(`Could not generate Spinda spot texture ${key}. Falling back to ${baseBattleSpriteKey}.`, error);
    return null;
  }
}

function isSpindaSpotEligible(pokemon: Pokemon, baseBattleSpriteKey: string): boolean {
  return (
    pokemon.species.speciesId === SpeciesId.SPINDA
    && !pokemon.isFusion()
    && /^(pkmn__(shiny__)?327)$/.test(baseBattleSpriteKey)
  );
}

function composeSpindaAtlas(
  atlas: Atlas,
  baseImage: HTMLImageElement,
  faceImage: HTMLImageElement,
  maskImage: HTMLImageElement,
  antiWiggleImage: HTMLImageElement,
  personality: number,
  palette: string,
): HTMLCanvasElement {
  const texture = atlas.textures[0];
  const canvas = document.createElement("canvas");
  canvas.width = texture.size.w;
  canvas.height = texture.size.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseImage, 0, 0);
  const output = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const baseData = imageDataForImage(baseImage);
  const maskData = imageDataForImage(maskImage);
  const antiWiggleData = imageDataForImage(antiWiggleImage);
  const colorMap = BODY_COLOR_MAPS[palette] ?? BODY_COLOR_MAPS.normal;
  const referenceFrame = referenceFrameForAtlas(texture.frames);
  const referenceAnchors = referenceFrame ? anchorsForFrame(referenceFrame) : null;

  for (const frame of texture.frames) {
    paintFrameSpots(
      output,
      baseData,
      maskData,
      antiWiggleData,
      frame,
      personality,
      colorMap,
      referenceFrame,
      referenceAnchors,
    );
  }

  ctx.putImageData(output, 0, 0);
  ctx.drawImage(faceImage, 0, 0);
  return canvas;
}

function paintFrameSpots(
  output: ImageData,
  baseData: ImageData,
  maskData: ImageData,
  antiWiggleData: ImageData,
  frame: AtlasFrame,
  personality: number,
  colorMap: ReadonlyMap<string, Rgba>,
  referenceFrame: AtlasFrame | null,
  referenceAnchors: Anchors | null,
): void {
  const anchors = anchorsForFrame(frame);
  if (!anchors) {
    return;
  }

  for (let i = 0; i < SPOTS.length; i++) {
    const spot = SPOTS[i];
    const offset = spotOffset(personality, i);
    const transform = spotTransform(anchors, spot, offset);
    const rows = SPOT_MASKS[spot.mask];
    const width = Math.max(...rows.map(row => row.length));
    const centerX = (width - 1) / 2;
    const centerY = (rows.length - 1) / 2;
    const bounds = transformedMaskBounds(transform, width, rows.length, centerX, centerY);
    const lockedPixels = collectAntiWiggleReferencePixels(
      rows,
      spot,
      offset,
      centerX,
      centerY,
      antiWiggleData,
      referenceFrame,
      referenceAnchors,
    );

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const local = inverseTransformPoint(transform, x, y);
        const maskX = Math.round(local.x + centerX);
        const maskY = Math.round(local.y + centerY);
        if (rows[maskY]?.[maskX] !== "1") {
          continue;
        }
        const lockKey = `${maskX},${maskY}`;
        if (
          lockedPixels.localCells.has(lockKey)
          || (spot.region !== "head" && isAntiWigglePixel(antiWiggleData, frame, x, y))
        ) {
          continue;
        }
        paintSpotPixel(output, baseData, maskData, frame, x, y, colorMap);
      }
    }
    for (const offset of lockedPixels.headOffsets) {
      paintSpotPixel(
        output,
        baseData,
        maskData,
        frame,
        anchors.headCenter.x + offset.x,
        anchors.headCenter.y + offset.y,
        colorMap,
        true,
        true,
      );
    }
  }
}

function collectAntiWiggleReferencePixels(
  rows: string[],
  spot: (typeof SPOTS)[number],
  pidOffset: Point,
  centerX: number,
  centerY: number,
  antiWiggleData: ImageData,
  referenceFrame: AtlasFrame | null,
  referenceAnchors: Anchors | null,
): AntiWigglePixels {
  const localCells = new Set<string>();
  const headOffsets: Point[] = [];
  if (spot.region === "head" || !referenceFrame || !referenceAnchors) {
    return { localCells, headOffsets };
  }
  const referenceTransform = spotTransform(referenceAnchors, spot, pidOffset);
  const bounds = transformedMaskBounds(
    referenceTransform,
    Math.max(...rows.map(row => row.length)),
    rows.length,
    centerX,
    centerY,
  );
  const painted = new Set<string>();
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const local = inverseTransformPoint(referenceTransform, x, y);
      const maskX = Math.round(local.x + centerX);
      const maskY = Math.round(local.y + centerY);
      if (rows[maskY]?.[maskX] !== "1") {
        continue;
      }
      const referenceSheet = untrimmedToSheet(referenceFrame, x, y);
      if (
        referenceSheet.x < 0
        || referenceSheet.y < 0
        || referenceSheet.x >= antiWiggleData.width
        || referenceSheet.y >= antiWiggleData.height
      ) {
        continue;
      }
      const antiWiggleColor = pixelHex(antiWiggleData, referenceSheet.x, referenceSheet.y);
      if (antiWiggleColor !== ANTI_WIGGLE_COLOR && antiWiggleColor !== ANTI_WIGGLE_BRIDGE_COLOR) {
        continue;
      }
      if (antiWiggleColor === ANTI_WIGGLE_COLOR) {
        localCells.add(`${maskX},${maskY}`);
      }
      const offset = point(x - referenceAnchors.headCenter.x, y - referenceAnchors.headCenter.y);
      const paintKey = `${offset.x},${offset.y}`;
      if (!painted.has(paintKey)) {
        painted.add(paintKey);
        headOffsets.push(offset);
      }
    }
  }
  return { localCells, headOffsets };
}

function isAntiWigglePixel(antiWiggleData: ImageData, frame: AtlasFrame, x: number, y: number): boolean {
  const sheet = untrimmedToSheet(frame, Math.round(x), Math.round(y));
  if (sheet.x < 0 || sheet.y < 0 || sheet.x >= antiWiggleData.width || sheet.y >= antiWiggleData.height) {
    return false;
  }
  return pixelHex(antiWiggleData, sheet.x, sheet.y) === ANTI_WIGGLE_COLOR;
}

function paintSpotPixel(
  output: ImageData,
  baseData: ImageData,
  maskData: ImageData,
  frame: AtlasFrame,
  x: number,
  y: number,
  colorMap: ReadonlyMap<string, Rgba>,
  allowMaskedPixel = false,
  allowUnmappedBodyColor = false,
): void {
  if (x < 0 || y < 0 || x >= frame.sourceSize.w || y >= frame.sourceSize.h) {
    return;
  }
  const sheet = untrimmedToSheet(frame, x, y);
  if (sheet.x < 0 || sheet.y < 0 || sheet.x >= output.width || sheet.y >= output.height) {
    return;
  }
  if (!allowMaskedPixel && pixelAlpha(maskData, sheet.x, sheet.y) !== 0) {
    return;
  }

  const color = colorMap.get(pixelHex(baseData, sheet.x, sheet.y));
  if (!color && !allowUnmappedBodyColor) {
    return;
  }

  const index = (sheet.y * output.width + sheet.x) * 4;
  const paintColor = color ?? NORMAL_SPOT_COLOR;
  output.data[index] = paintColor[0];
  output.data[index + 1] = paintColor[1];
  output.data[index + 2] = paintColor[2];
  output.data[index + 3] = paintColor[3] || NORMAL_SPOT_COLOR[3];
}

function anchorsForFrame(frame: AtlasFrame): Anchors | null {
  const values = POSE_ANCHORS[poseKey(frame)];
  if (!values) {
    return null;
  }
  return {
    headCenter: point(values[0], values[1]),
    nose: point(values[2], values[3]),
    leftEarTip: point(values[4], values[5]),
    leftEarRoot: point(values[6], values[7]),
    rightEarTip: point(values[8], values[9]),
    rightEarRoot: point(values[10], values[11]),
  };
}

function spotTransform(anchors: Anchors, spot: (typeof SPOTS)[number], pidOffset: Point): Transform {
  if (spot.region === "head") {
    return {
      origin: {
        x: anchors.headCenter.x + spot.base.x + pidOffset.x,
        y: anchors.headCenter.y + spot.base.y + pidOffset.y,
      },
      xAxis: point(1, 0),
      yAxis: point(0, 1),
    };
  }

  const root = spot.region === "leftEar" ? anchors.leftEarRoot : anchors.rightEarRoot;
  const tip = spot.region === "leftEar" ? anchors.leftEarTip : anchors.rightEarTip;
  const vector = point(tip.x - root.x, tip.y - root.y);
  const length = Math.hypot(vector.x, vector.y) || 1;
  const xAxis = point(vector.x / length, vector.y / length);
  const side = spot.region === "leftEar" ? -1 : 1;
  const yAxis = point(-xAxis.y * side, xAxis.x * side);

  return {
    origin: {
      x: root.x + xAxis.x * (spot.base.x + pidOffset.x) + yAxis.x * (spot.base.y + pidOffset.y),
      y: root.y + xAxis.y * (spot.base.x + pidOffset.x) + yAxis.y * (spot.base.y + pidOffset.y),
    },
    xAxis,
    yAxis,
  };
}

function ensureSpindaSpotAnimation(key: string): void {
  const originalWarn = console.warn;
  console.warn = () => {};
  const frames = globalScene.anims.generateFrameNames(key, {
    zeroPad: 4,
    suffix: ".png",
    start: 1,
    end: 400,
  });
  console.warn = originalWarn;

  if (globalScene.anims.exists(key)) {
    globalScene.anims.get(key).frameRate = 10;
    return;
  }
  globalScene.anims.create({ key, frames, frameRate: 10, repeat: -1 });
}

function copyVariantColorCache(sourceKey: string, targetKey: string): void {
  const cache = variantColorCache as Record<string, unknown>;
  if (Object.hasOwn(cache, sourceKey) && !Object.hasOwn(cache, targetKey)) {
    cache[targetKey] = cache[sourceKey];
  }
}

function referenceFrameForAtlas(frames: AtlasFrame[]): AtlasFrame | null {
  return frames.find(frame => frame.filename === "0001.png") ?? frames[0] ?? null;
}

function spotOffset(personality: number, index: number): Point {
  const byte = (personality >>> (index * 8)) & 0xff;
  return point((byte & 0x0f) - 8, ((byte >>> 4) & 0x0f) - 8);
}

function transformedMaskBounds(transform: Transform, width: number, height: number, centerX: number, centerY: number) {
  const corners = [
    transformPoint(transform, -centerX - 0.5, -centerY - 0.5),
    transformPoint(transform, width - centerX - 0.5, -centerY - 0.5),
    transformPoint(transform, -centerX - 0.5, height - centerY - 0.5),
    transformPoint(transform, width - centerX - 0.5, height - centerY - 0.5),
  ];
  return {
    minX: Math.floor(Math.min(...corners.map(corner => corner.x))) - 1,
    maxX: Math.ceil(Math.max(...corners.map(corner => corner.x))) + 1,
    minY: Math.floor(Math.min(...corners.map(corner => corner.y))) - 1,
    maxY: Math.ceil(Math.max(...corners.map(corner => corner.y))) + 1,
  };
}

function transformPoint(transform: Transform, x: number, y: number): Point {
  return {
    x: transform.origin.x + transform.xAxis.x * x + transform.yAxis.x * y,
    y: transform.origin.y + transform.xAxis.y * x + transform.yAxis.y * y,
  };
}

function inverseTransformPoint(transform: Transform, x: number, y: number): Point {
  const dx = x - transform.origin.x;
  const dy = y - transform.origin.y;
  return {
    x: dx * transform.xAxis.x + dy * transform.xAxis.y,
    y: dx * transform.yAxis.x + dy * transform.yAxis.y,
  };
}

function untrimmedToSheet(frame: AtlasFrame, x: number, y: number): Point {
  return {
    x: frame.frame.x + x - frame.spriteSourceSize.x,
    y: frame.frame.y + y - frame.spriteSourceSize.y,
  };
}

function imageDataForImage(image: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${src}`));
        image.src = getCachedUrl(src);
      }),
    );
  }
  return imageCache.get(src)!;
}

function loadAtlas(atlasPath: string): Promise<Atlas> {
  const path = `./images/pokemon/${atlasPath}.json`;
  if (!atlasCache.has(path)) {
    atlasCache.set(
      path,
      cachedFetch(path).then(response => {
        if (!response.ok) {
          throw new Error(`Could not load ${path}: ${response.status}`);
        }
        return response.json();
      }),
    );
  }
  return atlasCache.get(path)!;
}

function spotMask(width: number, segments: readonly (readonly [number, number, number])[]): string[] {
  const rows: string[] = [];
  for (const [height, left, right] of segments) {
    const row = ".".repeat(left) + "1".repeat(width - left - right) + ".".repeat(right);
    for (let i = 0; i < height; i++) {
      rows.push(row);
    }
  }
  return rows;
}

function poseKey(frame: AtlasFrame): string {
  const src = frame.frame;
  const source = frame.sourceSize;
  const offset = frame.spriteSourceSize;
  return [
    src.x,
    src.y,
    src.w,
    src.h,
    offset.x,
    offset.y,
    offset.w,
    offset.h,
    source.w,
    source.h,
    frame.rotated ? 1 : 0,
  ].join(":");
}

function pixelHex(imageData: ImageData, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return "00000000";
  }
  const index = (Math.floor(y) * imageData.width + Math.floor(x)) * 4;
  return [imageData.data[index], imageData.data[index + 1], imageData.data[index + 2], imageData.data[index + 3]]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function pixelAlpha(imageData: ImageData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return 0;
  }
  return imageData.data[(Math.floor(y) * imageData.width + Math.floor(x)) * 4 + 3];
}

function point(x: number, y: number): Point {
  return { x, y };
}
