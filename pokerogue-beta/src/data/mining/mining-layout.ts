import { cachedFetch } from "#utils/fetch-utils";

export interface MiningBoardLayout {
  cols: number;
  rows: number;
  cellSize: number;
  x: number;
  y: number;
}

export interface MiningTemplate {
  key: string;
  templateType: "reward" | "iron_block" | string;
  itemId?: string;
  rewardGroup?: string;
  viable?: boolean;
  clankOnHit?: boolean;
  assetPath?: string;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  widthCells: number;
  heightCells: number;
  maxPerBoard?: number;
  weight?: number;
  visible?: boolean;
  mask?: boolean[][];
  clankMask?: boolean[][];
}

export interface MiningLayoutObject {
  key: string;
  assetPath?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  visible?: boolean;
}

export interface MiningCrackSegment {
  segment: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MiningBaseFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MiningSupportSheets {
  iron?: {
    assetPath: string;
    cols: number;
    rows: number;
    cellSize: number;
    cells: {
      ironId: number | null;
      clank?: boolean;
    }[];
  };
  cracks?: {
    framePaths?: string[];
  };
}

export interface MiningLayoutData {
  schema: string;
  canvas: {
    width: number;
    height: number;
  };
  baseImage?: string;
  baseFrame?: MiningBaseFrame;
  objects?: MiningLayoutObject[];
  supportSheets?: MiningSupportSheets;
  crackSegments?: MiningCrackSegment[];
  board: MiningBoardLayout;
  itemTemplates: MiningTemplate[];
}

const MINING_LAYOUT_URL = "images/digging/mining-layout.json";

let miningLayout: MiningLayoutData | undefined;
let miningLayoutLoading: Promise<MiningLayoutData> | undefined;

export function loadMiningLayout(): Promise<MiningLayoutData> {
  if (miningLayout) {
    return Promise.resolve(miningLayout);
  }

  miningLayoutLoading ??= cachedFetch(MINING_LAYOUT_URL)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load mining layout: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<MiningLayoutData>;
    })
    .then(layout => {
      miningLayout = layout;
      return layout;
    })
    .catch(error => {
      miningLayoutLoading = undefined;
      throw error;
    });

  return miningLayoutLoading;
}

export function getMiningRewardTemplates(layout: MiningLayoutData): MiningTemplate[] {
  return layout.itemTemplates.filter(template => template.templateType === "reward" && template.viable !== false);
}

export function getMiningIronTemplates(layout: MiningLayoutData): MiningTemplate[] {
  const explicitTemplates = layout.itemTemplates.filter(template => template.templateType === "iron_block" && template.viable !== false);
  if (explicitTemplates.length > 0) {
    return explicitTemplates;
  }

  return buildIronTemplatesFromSupportSheet(layout);
}

function buildIronTemplatesFromSupportSheet(layout: MiningLayoutData): MiningTemplate[] {
  const sheet = layout.supportSheets?.iron;
  if (!sheet?.assetPath) {
    return [];
  }

  const ids = new Set<number>();
  for (const cell of sheet.cells ?? []) {
    if (cell.ironId != null) {
      ids.add(cell.ironId);
    }
  }

  return [...ids].sort((a, b) => a - b).map(id => {
    let minX = sheet.cols;
    let minY = sheet.rows;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < sheet.cells.length; index++) {
      if (sheet.cells[index]?.ironId !== id) {
        continue;
      }

      const x = index % sheet.cols;
      const y = Math.floor(index / sheet.cols);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const widthCells = Math.max(1, maxX - minX + 1);
    const heightCells = Math.max(1, maxY - minY + 1);
    const mask = Array.from({ length: heightCells }, () => Array.from({ length: widthCells }, () => false));
    const clankMask = Array.from({ length: heightCells }, () => Array.from({ length: widthCells }, () => false));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = sheet.cells[y * sheet.cols + x];
        if (cell?.ironId === id) {
          mask[y - minY][x - minX] = true;
          clankMask[y - minY][x - minX] = cell.clank !== false;
        }
      }
    }

    return {
      key: `iron_${id}`,
      templateType: "iron_block",
      assetPath: sheet.assetPath,
      sourceX: minX * sheet.cellSize,
      sourceY: minY * sheet.cellSize,
      sourceWidth: widthCells * sheet.cellSize,
      sourceHeight: heightCells * sheet.cellSize,
      widthCells,
      heightCells,
      viable: true,
      weight: 1,
      visible: true,
      mask,
      clankMask,
    };
  });
}
