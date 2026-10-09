import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { Arena } from "#field/arena";
import * as towerUtils from "#utils/pokemon-tower-utils";
import { createGreatHauntBoss } from "#utils/great-haunt-utils";
import type { PersistentModifier } from "#modifiers/modifier";
import { AttemptRunPhase } from "#phases/attempt-run-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { NewBattlePhase } from "#phases/new-battle-phase";
import { NewBiomeEncounterPhase } from "#phases/new-biome-encounter-phase";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { OptionSelectConfig } from "#ui/abstract-option-select-ui-handler";
import { getSpiritCount, getHauntingSkull, grantHauntingVictoryRewards } from "#utils/haunting-utils";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Pokemon Tower progression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ active: true });
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 50;
    game.scene.newArena(BiomeId.GRAVEYARD);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(game.scene, "loadBiomeAssets").mockResolvedValue(undefined);
    vi.spyOn(towerUtils, "rollTowerTrainerEncounter").mockReturnValue(true);
    vi.spyOn(Arena.prototype, "randomTrainerType").mockReturnValue(TrainerType.TOWER_JOEY);
  });

  function give(owner: 0 | 1 | 2, type: ModifierTypeFunc, count = 1) {
    const item = getModifierType(type).newModifier() as PersistentModifier;
    item.stackCount = count;
    game.scene.getPlayerModifiers(owner).push(item);
  }

  function enter() {
    game.scene.seasonalEncounters.enterTower(51);
    game.scene.newArena(BiomeId.POKEMON_TOWER);
  }

  it.each([1, 2, 3] as const)("uses seven remaining fights, then the wave-60 boss for %i players", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      give(owner, modifierTypes.OMINOUS_SKULL);
      give(owner, modifierTypes.LESSER_SPIRIT, 2);
    }
    const levels: number[] = [];
    const seeds = new Set<string>();
    enter();
    for (let floor = 1; floor <= 8; floor++) {
      const battle = game.scene.newBattle();
      seeds.add(game.scene.waveSeed);
      expect(battle.waveIndex).toBe(51);
      expect(battle.battleType).toBe(floor === 8 ? BattleType.WILD : BattleType.TRAINER);
      expect(battle.getBattlerCount()).toBe(count);
      expect(battle.enemyLevels).toHaveLength(floor === 8 ? 1 : count);
      expect(battle.trainer?.haunted).toBe(floor === 8 ? undefined : true);
      expect(battle.trainer?.config.trainerType).toBe(
        floor === 8 ? undefined : TrainerType.TOWER_JOEY,
      );
      expect(game.scene.seasonalEncounters.getTowerDifficultyWave()).toBe(floor === 8 ? 60 : 50 + floor);
      levels.push(battle.enemyLevels![0]);
      grantHauntingVictoryRewards();
      for (const owner of game.scene.getActivePlayerIndexes()) {
        expect(getSpiritCount(owner)).toBe(Math.min(2 + floor, 9));
      }
    }
    expect(seeds.size).toBe(8);
    expect(levels[7]).toBeGreaterThan(levels[0]);
    expect(game.scene.seasonalEncounters.hauntingsResolved).toBe(true);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    new NewBattlePhase().start();
    expect(game.scene.seasonalEncounters.tower).toBeUndefined();
    expect(game.scene.currentBattle.waveIndex).toBe(50);
    expect(queue.mock.calls.map(call => call[0])).toEqual(["SwitchBiomePhase", "NewBattlePhase"]);
    expect(queue).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.RUINS);
    game.scene.newArena(BiomeId.RUINS);
    expect(game.scene.newBattle().waveIndex).toBe(51);
  });

  it("waits for the least-progressed player while ready partners keep collecting", () => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    give(0, modifierTypes.PORTENT_SKULL);
    give(0, modifierTypes.LESSER_SPIRIT, 9);
    give(1, modifierTypes.MALEFIC_SKULL);
    give(1, modifierTypes.LESSER_SPIRIT, 12);
    give(2, modifierTypes.OMINOUS_SKULL);
    give(2, modifierTypes.LESSER_SPIRIT, 8);
    enter();
    game.scene.newBattle();
    expect(game.scene.seasonalEncounters.tower?.boss).toBe(false);
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0)).toBe(10);
    expect(getSpiritCount(1)).toBe(13);
    expect(getHauntingSkull(2)?.stage).toBe("portent");
    game.scene.newBattle();
    expect(game.scene.seasonalEncounters.tower?.boss).toBe(true);
  });

  it("starts repeat visits at the boss and awards another Greater Spirit", () => {
    give(0, modifierTypes.MALEFIC_SKULL);
    give(0, modifierTypes.GREATER_SPIRIT);
    game.scene.seasonalEncounters.resolveHauntings();
    enter();
    game.scene.newBattle();
    const seed = game.scene.waveSeed;
    expect(game.scene.seasonalEncounters.tower?.boss).toBe(true);
    expect(game.scene.seasonalEncounters.getTowerDifficultyWave()).toBe(60);
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0, true)).toBe(2);
    new NewBattlePhase().start();
    enter();
    game.scene.newBattle();
    expect(game.scene.waveSeed).not.toBe(seed);
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0, true)).toBe(3);
  });

  it.each([false, true])("keeps normal rewards but skips main-route advancement (boss: %s)", boss => {
    give(0, boss ? modifierTypes.PORTENT_SKULL : modifierTypes.OMINOUS_SKULL);
    enter();
    const battle = game.scene.newBattle();
    for (let i = 0; i < battle.enemyLevels!.length; i++) {
      const pokemon = boss ? createGreatHauntBoss(false) : battle.trainer!.genPartyMember(i);
      pokemon.hp = 0;
      battle.enemyParty.push(pokemon);
    }
    const phase = new VictoryPhase(3);
    vi.spyOn(phase, "getPokemon").mockReturnValue(battle.enemyParty[0]);
    vi.spyOn(game.scene, "applyPartyExp").mockImplementation(() => {});
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    phase.start();
    expect(push.mock.calls.map(call => call[0])).toEqual([
      "BattleEndPhase",
      ...(boss ? [] : ["TrainerVictoryPhase"]),
      "SelectModifierPhase",
      "NewBattlePhase",
    ]);
  });

  it.each([1, 2, 3] as const)("moves the first Tower trainer into view for %i players", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    enter();
    const battle = game.scene.newBattle();
    const tween = vi.spyOn(game.scene.tweens, "add");
    new NewBiomeEncounterPhase(false)["doEncounter"]();
    expect(tween).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([battle.trainer]),
        x: "+=300",
      }),
    );
  });

  it("prevents running even with guaranteed escape odds", () => {
    enter();
    const chance = vi.spyOn(AttemptRunPhase.prototype, "calculateEscapeChance").mockReturnValue(100);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    new AttemptRunPhase().start();
    expect(chance).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalledWith("NewBattlePhase");
  });

  it.each(
    ([1, 2, 3] as const).flatMap(count => [false, true].map(wild => ({ count, wild }))),
  )("restores floor, seed, roster, inventories and cap for $count players (wild: $wild)", async ({ count, wild }) => {
    vi.mocked(towerUtils.rollTowerTrainerEncounter).mockReturnValue(!wild);
    if (wild) {
      vi.spyOn(towerUtils, "rollTowerWildEntry").mockReturnValue({
        species: SpeciesId.MELOETTA,
        nickname: "S\u266aREN",
      });
    }
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.EEVEE), 40);
      game.scene.getPlayerParty(owner).push(pokemon);
      give(owner, modifierTypes.OMINOUS_SKULL);
      give(owner, modifierTypes.LESSER_SPIRIT, 2);
    }
    enter();
    const battle = game.scene.newBattle();
    if (count > 1) {
      const skull = getHauntingSkull(0)!;
      skull.stage = "malefic";
      skull.type = getModifierType(modifierTypes.MALEFIC_SKULL);
      give(0, modifierTypes.GREATER_SPIRIT);
      game.scene.updateModifiers(true, true, 0);
    }
    const hpBefore = game.scene.getActivePlayerIndexes().map(owner => {
      const pokemon = game.scene.getPlayerParty(owner)[0];
      pokemon.hp = Math.floor(pokemon.getMaxHp() * 0.4);
      return pokemon.hp;
    });
    vi.spyOn(game.scene.gameData, "saveAll").mockResolvedValue(true);
    vi.spyOn(game.scene.gameData, "setPokemonSeen").mockResolvedValue(undefined);
    vi.spyOn(Trainer.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Trainer.prototype, "initSprite").mockImplementation(() => {});
    vi.spyOn(Trainer.prototype, "genAI").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const phase = new EncounterPhase(false);
    const encounter = vi.spyOn(phase as any, "doEncounter").mockImplementation(() => {});
    phase.start();
    await vi.waitFor(() => expect(encounter).toHaveBeenCalled());
    expect(battle.enemyParty).toHaveLength(count);
    expect(battle.battleType).toBe(wild ? BattleType.WILD : BattleType.TRAINER);
    expect(
      battle.enemyParty.every(
        p => p.species.speciesId === (wild ? SpeciesId.MELOETTA : SpeciesId.RATTATA) && p.haunted,
      ),
    ).toBe(true);
    expect(game.scene.arena.weatherType).toBe(WeatherType.MIASMA);
    const seed = game.scene.waveSeed;
    const cap = game.scene.getMaxExpLevel();
    const ids = battle.enemyParty.map(p => p.id);
    const snapshot = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    await game.scene.gameData.loadSessionSnapshot(snapshot);
    expect(game.scene.seasonalEncounters.tower?.floor).toBe(1);
    expect(game.scene.seasonalEncounters.tower?.returnWave).toBe(51);
    expect(game.scene.waveSeed).toBe(seed);
    expect(game.scene.getMaxExpLevel()).toBe(cap);
    expect(game.scene.getEnemyParty().map(p => p.id)).toEqual(ids);
    expect(game.scene.currentBattle.getBattlerCount()).toBe(count);
    expect(game.scene.getEnemyParty().every(p => p.getNameToRender() === (wild ? "S\u266aREN" : "Top%"))).toBe(true);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      expect(getHauntingSkull(owner)?.stage).toBe(count > 1 && owner === 0 ? "malefic" : "ominous");
      expect(getSpiritCount(owner)).toBe(2);
      expect(game.scene.getPlayerParty(owner)[0].hp).toBe(hpBefore[owner]);
    }
  });

  async function vote(choices: number[]) {
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => {
      callback?.();
    });
    vi.spyOn(game.scene.ui, "setMode").mockImplementation(async (mode, ...args) => {
      if (mode === UiMode.OPTION_SELECT) {
        const config = args[0] as OptionSelectConfig;
        expect(config.options.map(option => option.label)).toEqual(["Enter the Tower", "Avoid the Tower"]);
        config.options[choices.shift()!].handler();
      }
    });
    new SelectBiomePhase().start();
    await vi.waitFor(() => expect(choices).toHaveLength(0));
    await Promise.resolve();
    await Promise.resolve();
  }

  it("lets a skull holder enter without a Map", async () => {
    give(0, modifierTypes.OMINOUS_SKULL);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await vote([0]);
    expect(game.scene.seasonalEncounters.tower?.returnWave).toBe(51);
    expect(queue).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.POKEMON_TOWER);
  });

  it("avoids the Tower without changing the ordinary route", async () => {
    give(0, modifierTypes.OMINOUS_SKULL);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await vote([1]);
    expect(game.scene.seasonalEncounters.tower).toBeUndefined();
    expect(queue).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.ABYSS);
  });

  it("uses actual skull-holder player indexes when resolving tied votes", async () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    give(0, modifierTypes.OMINOUS_SKULL);
    give(2, modifierTypes.PORTENT_SKULL);
    const tie = vi.spyOn(game.scene, "resolvePlayerTieBreak").mockReturnValue(2);
    await vote([1, 0]);
    expect(tie).toHaveBeenCalledWith([0, 2]);
    expect(game.scene.seasonalEncounters.tower).toBeDefined();
  });
});
