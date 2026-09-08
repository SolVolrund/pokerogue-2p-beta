import { SpeciesId } from "#enums/species-id";
import { cachedFetch } from "#utils/fetch-utils";
import accessoryCatalogData from "../../assets/images/pokemon/accessories/accessories.json";
import accessoryAnchorManifestData from "../../assets/images/pokemon/accessory-anchors/_manifest.json";

export type PokemonAccessoryLayer = "front" | "back";
export type PokemonAccessorySide = "front" | "back";

export interface PokemonAccessorySlot {
  id: string;
  label: string;
}

export interface PokemonAccessoryRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PokemonAccessoryPoint {
  x: number;
  y: number;
}

export interface PokemonAccessory {
  id: string;
  name: string;
  style: string;
  slots: string[];
  sourceImageName?: string;
  rect: PokemonAccessoryRect;
  pivot: PokemonAccessoryPoint;
}

export interface PokemonAccessoryOutfitItem {
  accessoryId: string;
  slot: string;
  speciesId?: SpeciesId;
  formIndex?: number;
  formKey?: string;
  side?: PokemonAccessorySide;
  layer?: PokemonAccessoryLayer;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
}

interface PokemonAccessoryAnchorSlot {
  available?: boolean;
  frames?: Record<string, PokemonAccessoryPoint>;
}

interface PokemonAccessoryAnchorData {
  pokemon: {
    key: string;
    source?: string;
    frameSize?: { w: number; h: number } | null;
  };
  slots: PokemonAccessorySlot[];
  anchorsBySide: Record<PokemonAccessorySide, Record<string, PokemonAccessoryAnchorSlot>>;
}

interface PokemonAccessoryCatalogData {
  slots?: PokemonAccessorySlot[];
  accessories: PokemonAccessory[];
}

interface PokemonAccessoryAnchorManifestData {
  files?: string[];
}

const accessoryCatalog = accessoryCatalogData as PokemonAccessoryCatalogData;
const accessoryAnchorManifest = accessoryAnchorManifestData as PokemonAccessoryAnchorManifestData;
const anchorDataBySpeciesId = new Map<SpeciesId, PokemonAccessoryAnchorData>();
const anchorDataBySpeciesFormKey = new Map<string, PokemonAccessoryAnchorData>();
let anchorDataLoading: Promise<void> | undefined;

function getAnchorDataKey(speciesId: SpeciesId, formKey?: string): string {
  return formKey ? `${speciesId}-${formKey}` : `${speciesId}`;
}

function registerPokemonAccessoryAnchorData(anchorData: PokemonAccessoryAnchorData): void {
  const key = String(anchorData.pokemon.key ?? "").trim();
  const keyParts = key.match(/^(\d+)(?:-(.+))?$/);
  if (!keyParts) {
    return;
  }

  const speciesId = Number(keyParts[1]) as SpeciesId;
  if (!Number.isInteger(speciesId)) {
    return;
  }

  const formKey = keyParts[2];
  if (formKey) {
    anchorDataBySpeciesFormKey.set(getAnchorDataKey(speciesId, formKey), anchorData);
    return;
  }

  anchorDataBySpeciesId.set(speciesId, anchorData);
}

function getAnchorData(speciesId: SpeciesId, formKey?: string): PokemonAccessoryAnchorData | undefined {
  return formKey ? anchorDataBySpeciesFormKey.get(getAnchorDataKey(speciesId, formKey)) : anchorDataBySpeciesId.get(speciesId);
}

export function loadPokemonAccessoryAnchors(): Promise<void> {
  anchorDataLoading ??= Promise.all(
    (accessoryAnchorManifest.files ?? []).map(async fileName => {
      try {
        const response = await cachedFetch(`./images/pokemon/accessory-anchors/${fileName}`);
        if (!response.ok) {
          console.warn(`Failed to load accessory anchor JSON ${fileName}: ${response.status}`);
          return;
        }
        registerPokemonAccessoryAnchorData(await response.json() as PokemonAccessoryAnchorData);
      } catch (error) {
        console.warn(`Failed to load accessory anchor JSON ${fileName}.`, error);
      }
    }),
  ).then(() => undefined);

  return anchorDataLoading;
}

export function hasPokemonAccessoryAnchors(speciesId: SpeciesId, formKey?: string, side?: PokemonAccessorySide): boolean {
  if (side) {
    return getPokemonAccessorySlots(speciesId, side, formKey).length > 0;
  }
  return getPokemonAccessorySlots(speciesId, "front", formKey).length > 0
    || getPokemonAccessorySlots(speciesId, "back", formKey).length > 0;
}

export function getPokemonAccessories(): PokemonAccessory[] {
  return accessoryCatalog.accessories ?? [];
}

export function getPokemonAccessory(accessoryId: string): PokemonAccessory | undefined {
  return getPokemonAccessories().find(accessory => accessory.id === accessoryId);
}

export function getPokemonAccessoryCatalogSlots(): PokemonAccessorySlot[] {
  return accessoryCatalog.slots ?? [];
}

export function getPokemonAccessoriesForSlot(slot: string): PokemonAccessory[] {
  return getPokemonAccessories().filter(accessory => accessory.slots.includes(slot));
}

export function getPokemonAccessorySlots(
  speciesId: SpeciesId,
  side: PokemonAccessorySide = "front",
  formKey?: string,
): PokemonAccessorySlot[] {
  const anchorData = getAnchorData(speciesId, formKey);
  if (!anchorData) {
    return [];
  }
  const anchors = anchorData.anchorsBySide[side] ?? {};
  return anchorData.slots.filter(slot => {
    const slotAnchors = anchors[slot.id];
    return slotAnchors?.available !== false && Object.keys(slotAnchors?.frames ?? {}).length > 0;
  });
}

export function getPokemonAccessoryAnchor(
  speciesId: SpeciesId,
  slot: string,
  frameName: string,
  side: PokemonAccessorySide = "front",
  formKey?: string,
): PokemonAccessoryPoint | undefined {
  const frames = getAnchorData(speciesId, formKey)?.anchorsBySide[side]?.[slot]?.frames;
  if (!frames) {
    return undefined;
  }
  const normalizedFrameName = /^\d+$/.test(frameName) ? `${frameName.padStart(4, "0")}.png` : frameName;
  return frames[frameName] ?? frames[normalizedFrameName] ?? Object.values(frames)[0];
}

export function getPokemonAccessoryFrameSize(
  speciesId: SpeciesId,
  formKey?: string,
): { w: number; h: number } | undefined {
  return getAnchorData(speciesId, formKey)?.pokemon.frameSize ?? undefined;
}
