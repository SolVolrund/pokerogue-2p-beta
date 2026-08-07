import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { type PermanentStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { randSeedItem } from "#utils/common";

export const CLASSIC_FINAL_BOSS_SEGMENTS = 5;
export const UNOWN_REAL_FINAL_BOSS_SEGMENTS = 8;
export const CLASSIC_FINAL_BOSS_VITAMIN_STACKS_PER_EXTRA_PLAYER = 5;
export const CLASSIC_FINAL_BOSS_MULTIPLAYER_SCALING_STATS: readonly PermanentStat[] = [Stat.HP, Stat.DEF, Stat.SPDEF];

export const UNOWN_TEASER_CODES = ["SPEED", "HEALTH", "SPATK", "PAPA!?", "UNCLE?", "MAMA!?"] as const;
export const UNOWN_CRYSTAL_GAUNTLET_START_WAVE = 201;
export const UNOWN_CRYSTAL_GAUNTLET_END_WAVE = 220;
export const UNOWN_CRYSTAL_END_WAVE = 219;
export const UNOWN_REAL_FINAL_BOSS_WAVE = 220;
export const MOLLY_HALE_CRYSTAL_ENCOUNTER_CHANCE = 30;

const IGNORED_UNOWN_TEASER_CHARACTERS = new Set([" ", ".", "-", "_"]);
const UNOWN_FINAL_BOSS_HELPER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export interface UnownFinalBossHelperSlotState {
  fieldIndex: number;
  speciesIds: SpeciesId[];
  nextIndex: number;
  pokemonId?: number;
}

export interface UnownFinalBossState {
  bossPokemonId?: number;
  helperSlots: UnownFinalBossHelperSlotState[];
}

export function isClassicOrChallengeMode(modeId: GameModes): boolean {
  return modeId === GameModes.CLASSIC || modeId === GameModes.CHALLENGE;
}

export function isUnownCrystalGauntletWave(waveIndex: number, modeId: GameModes): boolean {
  return (
    isClassicOrChallengeMode(modeId)
    && waveIndex >= UNOWN_CRYSTAL_GAUNTLET_START_WAVE
    && waveIndex <= UNOWN_CRYSTAL_GAUNTLET_END_WAVE
  );
}

export function isUnownCrystalBossRushWave(waveIndex: number, modeId: GameModes): boolean {
  return isUnownCrystalGauntletWave(waveIndex, modeId) && waveIndex < UNOWN_REAL_FINAL_BOSS_WAVE;
}

export function isUnownCrystalEndWave(waveIndex: number, modeId: GameModes): boolean {
  return isClassicOrChallengeMode(modeId) && waveIndex === UNOWN_CRYSTAL_END_WAVE;
}

export function isUnownRealFinalBossWave(waveIndex: number, modeId: GameModes): boolean {
  return isClassicOrChallengeMode(modeId) && waveIndex === UNOWN_REAL_FINAL_BOSS_WAVE;
}

export function getUnownFinalBossFieldIndex(fieldSlotCount: number): number {
  return fieldSlotCount > 2 ? 2 : 0;
}

export function getUnownFinalBossHelperFieldIndexes(fieldSlotCount: number): number[] {
  if (fieldSlotCount > 2) {
    return [0, 1];
  }

  return fieldSlotCount > 1 ? [1] : [];
}

export function createUnownFinalBossState(fieldSlotCount: number): UnownFinalBossState {
  const helperFieldIndexes = getUnownFinalBossHelperFieldIndexes(fieldSlotCount);
  const helperQueues = createUnownFinalBossHelperQueues(helperFieldIndexes.length);

  return {
    helperSlots: helperFieldIndexes.map((fieldIndex, slotIndex) => ({
      fieldIndex,
      speciesIds: helperQueues[slotIndex] ?? [],
      nextIndex: 0,
    })),
  };
}

export function getUnownFinalBossHelperSlot(
  state: UnownFinalBossState | undefined,
  fieldIndex: number,
): UnownFinalBossHelperSlotState | undefined {
  return state?.helperSlots.find(slot => slot.fieldIndex === fieldIndex);
}

export function getNextUnownFinalBossHelperSpeciesId(
  helperSlot: UnownFinalBossHelperSlotState,
): SpeciesId | undefined {
  const speciesId = helperSlot.speciesIds[helperSlot.nextIndex];
  if (speciesId !== undefined) {
    helperSlot.nextIndex++;
  }

  return speciesId;
}

function createUnownFinalBossHelperQueues(queueCount: number): SpeciesId[][] {
  if (queueCount < 1) {
    return [];
  }

  const forwardQueue = createUnownFinalBossHelperQueue(UNOWN_FINAL_BOSS_HELPER_LETTERS);
  const queues = [forwardQueue];
  if (queueCount > 1) {
    queues.push(createUnownFinalBossHelperQueue([...UNOWN_FINAL_BOSS_HELPER_LETTERS].reverse()));
  }

  return queues;
}

function createUnownFinalBossHelperQueue(letters: string[]): SpeciesId[] {
  const eligibleSpecies = speciesDataRegistry.getAllSpecies().filter(species => {
    return species.speciesId !== SpeciesId.UNOWN && !speciesDataRegistry.hasEvolutions(species.speciesId);
  });

  return letters.map(letter => {
    const candidates = eligibleSpecies.filter(species => species.name.toUpperCase().startsWith(letter));
    return randSeedItem(candidates.length > 0 ? candidates : eligibleSpecies).speciesId;
  });
}

export function getUnownTeaserFormKey(character: string): string | undefined {
  const normalizedCharacter = character.toUpperCase();
  if (normalizedCharacter >= "A" && normalizedCharacter <= "Z") {
    return normalizedCharacter.toLowerCase();
  }

  switch (normalizedCharacter) {
    case "!":
      return "exclamation";
    case "?":
      return "question";
    default:
      return;
  }
}

export function getUnownTeaserFormKeys(code: string): string[] {
  return [...code].reduce<string[]>((formKeys, character) => {
    if (IGNORED_UNOWN_TEASER_CHARACTERS.has(character)) {
      return formKeys;
    }

    const formKey = getUnownTeaserFormKey(character);
    if (formKey) {
      formKeys.push(formKey);
    }
    return formKeys;
  }, []);
}

export function isClassicFinalBossPhaseTwo(pokemon: Pokemon): boolean {
  switch (pokemon.species.speciesId) {
    case SpeciesId.ETERNATUS:
      return pokemon.formIndex > 0;
    case SpeciesId.NECROZMA:
      return pokemon.hasSpecies(SpeciesId.NECROZMA, "ultra");
    case SpeciesId.ARCEUS:
      return pokemon.hasSpecies(SpeciesId.ARCEUS, "legend");
    default:
      return false;
  }
}

export function isClassicFinalBossPhaseOne(pokemon: Pokemon): boolean {
  switch (pokemon.species.speciesId) {
    case SpeciesId.ETERNATUS:
      return pokemon.formIndex === 0;
    case SpeciesId.NECROZMA:
      return (
        pokemon.hasSpecies(SpeciesId.NECROZMA, "dusk-mane") || pokemon.hasSpecies(SpeciesId.NECROZMA, "dawn-wings")
      );
    case SpeciesId.ARCEUS:
      return pokemon.hasSpecies(SpeciesId.ARCEUS) && !pokemon.hasSpecies(SpeciesId.ARCEUS, "legend");
    default:
      return false;
  }
}
