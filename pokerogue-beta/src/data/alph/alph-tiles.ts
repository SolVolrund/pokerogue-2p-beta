import type { PlayerIndex } from "#app/battle-scene";
import type { MoveId } from "#enums/move-id";

export const ALPH_TILE_CHARACTERS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "QuestionMark",
  "Exclamation",
] as const;

export const ALPH_INFINITE_TILE_CHARACTERS = ["hyphen", "blank"] as const;

export type AlphFiniteTileCharacter = (typeof ALPH_TILE_CHARACTERS)[number];
export type AlphInfiniteTileCharacter = (typeof ALPH_INFINITE_TILE_CHARACTERS)[number];
export type AlphTileCharacter = AlphFiniteTileCharacter | AlphInfiniteTileCharacter;
export type AlphTileCounts = Partial<Record<AlphFiniteTileCharacter, number>>;

export const ALPH_MAX_TILE_COUNT = 5;

export function createInitialAlphTileCounts(): AlphTileCounts {
  return {};
}

export function normalizeAlphTileCharacter(character: string | undefined): AlphTileCharacter {
  switch (character) {
    case "?":
    case "Question":
    case "QuestionMark":
      return "QuestionMark";
    case "!":
    case "Exclamation":
      return "Exclamation";
    case "-":
    case "hyphen":
      return "hyphen";
    case "":
    case "blank":
      return "blank";
    default:
      return ALPH_TILE_CHARACTERS.includes(character as AlphFiniteTileCharacter)
        ? (character as AlphFiniteTileCharacter)
        : "blank";
  }
}

export function isFiniteAlphTileCharacter(character: AlphTileCharacter): character is AlphFiniteTileCharacter {
  return ALPH_TILE_CHARACTERS.includes(character as AlphFiniteTileCharacter);
}

export function isInfiniteAlphTileCharacter(character: AlphTileCharacter): character is AlphInfiniteTileCharacter {
  return !isFiniteAlphTileCharacter(character);
}

export function getAlphTileTextureKey(character: AlphTileCharacter): string {
  return `alph_tile_${character}`;
}

export function getAlphTileItemIconKey(character: AlphFiniteTileCharacter): string {
  return character === "QuestionMark" ? "unown_tile_Question" : `unown_tile_${character}`;
}

export function getAlphTileDisplayCharacter(character: AlphTileCharacter): string {
  switch (character) {
    case "QuestionMark":
      return "?";
    case "Exclamation":
      return "!";
    case "hyphen":
      return "-";
    case "blank":
      return "";
    default:
      return character;
  }
}

export function getAlphTileLookupKey(characters: AlphTileCharacter[]): string {
  return characters
    .map(character => getAlphTileDisplayCharacter(character))
    .join("")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

export function getAlphTileCount(counts: AlphTileCounts, character: AlphTileCharacter): number {
  if (isInfiniteAlphTileCharacter(character)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.min(ALPH_MAX_TILE_COUNT, counts[character] ?? 0));
}

export function setAlphTileCount(counts: AlphTileCounts, character: AlphTileCharacter, count: number): void {
  if (isInfiniteAlphTileCharacter(character)) {
    return;
  }

  counts[character] = Math.max(0, Math.min(ALPH_MAX_TILE_COUNT, Math.floor(count)));
}

export function addAlphTile(counts: AlphTileCounts, character: AlphTileCharacter, amount = 1): boolean {
  if (isInfiniteAlphTileCharacter(character)) {
    return true;
  }

  const currentCount = getAlphTileCount(counts, character);
  if (currentCount >= ALPH_MAX_TILE_COUNT) {
    return false;
  }

  setAlphTileCount(counts, character, currentCount + amount);
  return true;
}

export function removeAlphTile(counts: AlphTileCounts, character: AlphTileCharacter, amount = 1): boolean {
  if (isInfiniteAlphTileCharacter(character)) {
    return true;
  }

  const currentCount = getAlphTileCount(counts, character);
  if (currentCount < amount) {
    return false;
  }

  setAlphTileCount(counts, character, currentCount - amount);
  return true;
}

export interface AlphWallConfig {
  playerIndex: PlayerIndex;
  onClose: () => void;
  onMoveSpell: (partyMemberIndex: number, moveId: MoveId) => void;
}
