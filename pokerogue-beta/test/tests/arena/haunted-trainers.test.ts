import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { TitlePhase } from "#phases/title-phase";
import { TrainerData } from "#system/trainer-data";
import { GameManager } from "#test/framework/game-manager";
import type { NewBattleInitialProps } from "#types/new-battle-props";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Haunted trainer integration", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => undefined);
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => undefined);
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ active: true });
    vi.spyOn(activeOverrides, "BATTLE_TYPE_OVERRIDE", "get").mockReturnValue(null);
    vi.spyOn(activeOverrides, "RANDOM_TRAINER_OVERRIDE", "get").mockReturnValue(null);
    vi.spyOn(activeOverrides, "DISABLE_STANDARD_TRAINERS_OVERRIDE", "get").mockReturnValue(false);
    vi.spyOn(activeOverrides, "WEATHER_OVERRIDE", "get").mockReturnValue(WeatherType.NONE);
  });

  it.each([1, 10, 20, 25, 200])("does not roll or accumulate pity on protected wave %i", wave => {
    const roll = vi.spyOn(game.scene.seasonalEncounters, "roll");
    expect(game.scene["rollHauntingEncounter"](wave)).toBe(false);
    expect(roll).not.toHaveBeenCalled();
  });

  it.each([BiomeId.ROCKET_HQ, BiomeId.POKEMON_TOWER, BiomeId.END])("protects special biome %i", biome => {
    game.scene.newArena(biome);
    const roll = vi.spyOn(game.scene.seasonalEncounters, "roll");
    expect(game.scene["rollHauntingEncounter"](52)).toBe(false);
    expect(roll).not.toHaveBeenCalled();
  });

  it("does not change mystery-event pity, and preserves an already selected mystery event", () => {
    vi.spyOn(game.scene as any, "isWaveMysteryEncounter").mockReturnValue(true);
    const roll = vi.spyOn(game.scene.seasonalEncounters, "roll");
    const props: NewBattleInitialProps = { waveIndex: 52 };
    game.scene["handleNonFixedBattle"](props);
    expect(props.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
    expect(roll).not.toHaveBeenCalled();
  });

  it.each([
    [1, false],
    [2, false],
    [3, false],
    [2, true],
    [3, true],
  ] as const)("converts an ordinary wave with one shared roll for %i players (Vs: %s)", (count, vs) => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count, [], vs);
    vi.spyOn(game.scene as any, "isWaveMysteryEncounter").mockReturnValue(false);
    vi.spyOn(game.scene.gameMode, "isWaveTrainer").mockReturnValue(false);
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    vi.spyOn(game.scene as any, "generateNewBattleTrainer").mockReturnValue(trainer);
    vi.spyOn(Common, "randSeedInt").mockReturnValue(0);
    const roll = vi.spyOn(game.scene.seasonalEncounters, "roll");
    const originalPity = game.scene.mysteryEncounterSaveData.encounterSpawnChance;
    const props: NewBattleInitialProps = { waveIndex: 52 };
    game.scene["handleNonFixedBattle"](props);
    expect(props.battleType).toBe(BattleType.TRAINER);
    expect(props.trainer?.haunted).toBe(true);
    expect(props.trainer?.getName()).toContain("Haunted");
    expect(roll).toHaveBeenCalledTimes(1);
    expect(game.scene.mysteryEncounterSaveData.encounterSpawnChance).toBe(originalPity);
    expect(game.scene["checkIsDouble"]({ ...props, battleType: BattleType.TRAINER })).toBe(count > 1);
  });

  it("preserves seeded outcomes without changing the main RNG stream", () => {
    game.scene.setSeed("haunting-replay");
    game.scene.resetSeed(52);
    const rngState = Phaser.Math.RND.state();
    const first = game.scene["rollHauntingEncounter"](52);
    expect(Phaser.Math.RND.state()).toBe(rngState);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ active: true });
    expect(game.scene["rollHauntingEncounter"](52)).toBe(first);
    expect(Phaser.Math.RND.state()).toBe(rngState);
  });

  it("forces the starting Haunted trainer without enabling hauntings on later waves", () => {
    vi.spyOn(activeOverrides, "STARTING_WAVE_OVERRIDE", "get").mockReturnValue(12);
    vi.spyOn(activeOverrides, "STARTING_HAUNTED_TRAINER_OVERRIDE", "get").mockReturnValue(true);
    game.scene.seasonalEncounters = new SeasonalEncounterState();
    const mystery = vi.spyOn(game.scene as any, "isWaveMysteryEncounter").mockReturnValue(true);
    const props: NewBattleInitialProps = { waveIndex: 12 };
    game.scene["handleNonFixedBattle"](props);
    expect(props.battleType).toBe(BattleType.TRAINER);
    expect(props.trainer?.haunted).toBe(true);
    expect(mystery).not.toHaveBeenCalled();
    const later: NewBattleInitialProps = { waveIndex: 13 };
    game.scene["handleNonFixedBattle"](later);
    expect(later.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
    expect(later.trainer).toBeUndefined();
  });

  it("guarantees a level-1 Haunted trainer on the Graveyard wave-9 test start", () => {
    vi.spyOn(activeOverrides, "STARTING_WAVE_OVERRIDE", "get").mockReturnValue(9);
    vi.spyOn(activeOverrides, "STARTING_HAUNTED_TRAINER_OVERRIDE", "get").mockReturnValue(true);
    vi.spyOn(activeOverrides, "ENEMY_LEVEL_OVERRIDE", "get").mockReturnValue(1);
    game.scene.newArena(BiomeId.GRAVEYARD);
    const battle = game.scene.newBattle();
    expect(battle.waveIndex).toBe(9);
    expect(battle.trainer?.haunted).toBe(true);
    expect(battle.trainer!.genPartyMember(0).level).toBe(1);
  });

  it("applies the 100% override outside the season and through cooldown, but respects protected waves and completion", () => {
    vi.spyOn(activeOverrides, "HAUNTED_ENCOUNTER_CHANCE_OVERRIDE", "get").mockReturnValue(100);
    vi.spyOn(Common, "randSeedInt").mockReturnValue(99);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ battlesUntilEligible: 3 });
    expect(game.scene["rollHauntingEncounter"](52)).toBe(true);
    expect(game.scene["rollHauntingEncounter"](53)).toBe(true);
    expect(game.scene["rollHauntingEncounter"](10)).toBe(false);
    game.scene.seasonalEncounters.resolveHauntings();
    expect(game.scene["rollHauntingEncounter"](54)).toBe(false);
  });

  it("disables eligible hauntings at a 0% override", () => {
    vi.spyOn(activeOverrides, "HAUNTED_ENCOUNTER_CHANCE_OVERRIDE", "get").mockReturnValue(0);
    vi.spyOn(Common, "randSeedInt").mockReturnValue(0);
    expect(game.scene["rollHauntingEncounter"](52)).toBe(false);
  });

  it.each([2, 3] as const)("uses the host's October season across different client dates in %ip", count => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
      const host = new TitlePhase();
      host["announceTwoPlayerProfileForStartup"] = () => {};
      host["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
      vi.spyOn(host, "end").mockImplementation(() => {});
      vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
      const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(false);
      host["startMultiplayerRun"](GameModes.CLASSIC, count, 6);
      const payload: TwoPlayerTitleStart = JSON.parse(JSON.stringify(broadcast.mock.calls[0][0]));
      expect(payload.hauntingSeasonActive).toBe(true);
      vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
      const guest = new TitlePhase();
      guest["announceTwoPlayerProfileForStartup"] = () => {};
      guest["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
      vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
      expect(guest["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
      expect(game.scene.seasonalEncounters.active).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes and restores the trainer's Haunted variant", () => {
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    trainer.haunted = true;
    const restored = new TrainerData(JSON.parse(JSON.stringify(new TrainerData(trainer)))).toTrainer();
    expect(restored.haunted).toBe(true);
    expect(restored.getName()).toBe(trainer.getName());
  });

  it("marks the full enemy party, starts battle-long Miasma, and saves both before play", async () => {
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    trainer.haunted = true;
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 52,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    game.scene.currentBattle.enemyLevels = [50, 50, 50];
    vi.spyOn(game.scene.gameData, "saveAll").mockResolvedValue(true);
    vi.spyOn(game.scene.gameData, "setPokemonSeen").mockResolvedValue(undefined);
    vi.spyOn(trainer, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(trainer, "initSprite").mockImplementation(() => {});
    vi.spyOn(trainer, "genAI").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const phase = new EncounterPhase(false);
    const encounter = vi.spyOn(phase as any, "doEncounter").mockImplementation(() => {});
    phase.start();
    await vi.waitFor(() => expect(encounter).toHaveBeenCalled());
    expect(game.scene.getEnemyParty()).toHaveLength(3);
    for (const pokemon of game.scene.getEnemyParty()) {
      expect(pokemon.haunted).toBe(true);
      expect(pokemon.getTypes()).toContain(PokemonType.GHOST);
    }
    expect(game.scene.arena.weatherType).toBe(WeatherType.MIASMA);
    expect(game.scene.arena.weather?.turnsLeft).toBe(0);
    const saved = game.scene.gameData.getSessionSaveData();
    expect(saved.seasonalEncounters?.active).toBe(true);
    expect(saved.trainer.haunted).toBe(true);
    expect(saved.enemyParty.every(pokemon => pokemon.haunted)).toBe(true);

    // Restoring a run after clearing Miasma must not restart the encounter weather.
    game.scene.arena.trySetWeather(WeatherType.NONE);
    game.scene.seasonalEncounters.resolveHauntings();
    const snapshot = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await game.scene.gameData.loadSessionSnapshot(snapshot);
      expect(game.scene.currentBattle.trainer?.haunted).toBe(true);
      expect(game.scene.seasonalEncounters.hauntingsResolved).toBe(true);
      expect(game.scene.getEnemyParty().every(pokemon => pokemon.haunted)).toBe(true);
      expect(game.scene.arena.weatherType).toBe(WeatherType.NONE);
      const loadedPhase = new EncounterPhase(true);
      const loadedEncounter = vi.spyOn(loadedPhase as any, "doEncounter").mockImplementation(() => {});
      loadedPhase.start();
      await vi.waitFor(() => expect(loadedEncounter).toHaveBeenCalled());
      expect(game.scene.arena.weatherType).toBe(WeatherType.NONE);
    }
  });

  it.each([WeatherType.MIASMA, WeatherType.RAIN])("only clears lingering Miasma at battle end (%i)", weather => {
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    trainer.haunted = true;
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 52,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    game.scene.arena.trySetWeather(weather);
    const phase = new BattleEndPhase(false);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    expect(game.scene.arena.weatherType).toBe(weather === WeatherType.MIASMA ? WeatherType.NONE : weather);
  });
});
