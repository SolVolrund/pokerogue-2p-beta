import { Battle } from "#app/battle";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import * as phases from "#mystery-encounters/encounter-phase-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounters";
import { SpookyInvitationEncounter } from "#mystery-encounters/spooky-invitation-encounter";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import * as eventSettings from "#system/settings-events";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const id = MysteryEncounterType.SPOOKY_INVITATION;
describe("A Spooky Invitation", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  let encounter: MysteryEncounter;
  beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaser);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [1]);
    game.scene.currentBattle = new Battle(game.scene.gameMode, { waveIndex: 61, battleType: BattleType.WILD, double: true });
    game.scene.newArena(BiomeId.GRAVEYARD, 0, true);
    for (const p of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerParty(p).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 35));
    }
    game.scene.seasonalEncounters = new SeasonalEncounterState();
    game.scene.currentBattle.mysteryEncounter = encounter = new MysteryEncounter(SpookyInvitationEncounter);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(phases, "leaveEncounterWithoutBattle").mockImplementation(() => {});
  });
  afterEach(() => game.scene.configureTwoPlayerMode(false));
  function begin() {
    const phase = new MysteryEncounterPhase();
    vi.spyOn(phase, "continueEncounter").mockImplementation(() => {});
    phase.start();
    return phase;
  }
  async function roundTrip() {
    const snapshot = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, v) => typeof v === "bigint" ? String(v) : v);
    await game.scene.gameData.loadSessionSnapshot(snapshot);
  }
  it("is an uncommon one-time offer only in Graveyard and Abyss, with the spirit behind the trainer", () => {
    expect([...mysteryEncountersByBiome].filter(([, pool]) => pool.includes(id)).map(([biome]) => biome))
      .toEqual([BiomeId.GRAVEYARD, BiomeId.ABYSS]);
    expect(encounter.maxAllowedEncounters).toBe(1);
    expect(encounter.encounterTier).toBe(MysteryEncounterTier.GREAT);
    expect(encounter.meetsRequirements()).toBe(true);
    game.scene.seasonalEncounters.active = true;
    expect(encounter.meetsRequirements()).toBe(false);
    game.scene.seasonalEncounters.active = false;
    game.scene.seasonalEncounters.resolveHauntings();
    expect(encounter.meetsRequirements()).toBe(false);
    expect(encounter.spriteConfigs).toMatchObject([
      { spriteKey: "haunting_spirit", repeat: true, y: 4 }, { spriteKey: "hex_maniac", hasShadow: true },
    ]);
  });
  it.each([0, 1])("skips the CPU and resolves human votes Yes then option %i, including after resume", async last => {
    const phase = begin();
    const tieBreak = vi.spyOn(game.scene, "resolvePlayerTieBreak");
    phase.handleOptionSelect(encounter.options[0], 0);
    expect(game.scene.activePlayerIndex).toBe(2);
    expect(phase.continueEncounter).not.toHaveBeenCalled();
    phase.handleOptionSelect(encounter.options[last], last);
    expect(phase.continueEncounter).toHaveBeenCalledOnce();
    expect(tieBreak).not.toHaveBeenCalled();
    expect(encounter.selectedOption).toBe(encounter.options[last]);
    await encounter.selectedOption!.onOptionPhase();
    expect(phases.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    await roundTrip();
    expect(game.scene.seasonalEncounters.active).toBe(last === 0);
    expect(game.scene.seasonalEncounters.lastHauntingWave).toBe(0);
    expect(game.scene.mysteryEncounterSaveData.encounteredEvents.filter(e => e.type === id)).toMatchObject([{ selectedOption: last }]);
    expect(game.scene.seasonalEncounters.roll(62, () => 0)).toBe(last === 0);
  });
  it("ends on the first veto without changing dormant haunting state", async () => {
    const before = JSON.stringify(game.scene.seasonalEncounters);
    const phase = begin();
    phase.handleOptionSelect(encounter.options[1], 1);
    expect(phase.continueEncounter).toHaveBeenCalledOnce();
    await encounter.selectedOption!.onOptionPhase();
    expect(JSON.stringify(game.scene.seasonalEncounters)).toBe(before);
  });
  it("will not pick her outside her biomes or after a saved decline, even as the only enabled event", async () => {
    vi.spyOn(eventSettings, "isMysteryEncounterEnabledBySettings").mockImplementation(type => type === id);
    const scene = game.scene;
    expect(scene.getMysteryEncounter().encounterType).toBe(id);
    scene.newArena(BiomeId.FOREST, 0, true);
    expect(scene.getMysteryEncounter().encounterType).not.toBe(id);
    scene.newArena(BiomeId.GRAVEYARD, 0, true);
    const phase = begin();
    phase.handleOptionSelect(encounter.options[1], 1);
    await encounter.selectedOption!.onOptionPhase();
    await roundTrip();
    scene.currentBattle.waveIndex += 10;
    scene.newArena(BiomeId.ABYSS, 0, true);
    expect(scene.getMysteryEncounter().encounterType).not.toBe(id);
  });
  it("accepts in solo without starting a trainer battle or granting a skull", async () => {
    game.scene.configureTwoPlayerMode(false);
    const phase = begin();
    phase.handleOptionSelect(encounter.options[0], 0);
    await encounter.selectedOption!.onOptionPhase();
    expect(game.scene.seasonalEncounters.active).toBe(true);
    expect(game.scene.currentBattle.trainer).toBeFalsy();
    expect(game.scene.getPlayerModifiers(0)).toHaveLength(0);
  });
  it("lets one human accept without any CPU votes", async () => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [1, 2]);
    const phase = begin();
    phase.handleOptionSelect(encounter.options[0], 0);
    expect(phase.continueEncounter).toHaveBeenCalledOnce();
    await encounter.selectedOption!.onOptionPhase();
    expect(game.scene.seasonalEncounters.active).toBe(true);
  });
});
