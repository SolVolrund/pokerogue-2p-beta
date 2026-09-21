import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allBiomes, modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Arena, getBiomeAssetKey, getBiomeHasProps } from "#field/arena";
import { Trainer } from "#field/trainer";
import { Pokemon } from "#field/pokemon";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { TrainerVictoryPhase } from "#phases/trainer-victory-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Rocket HQ", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.newBattle();
    game.scene.arena = new Arena(BiomeId.ROCKET_HQ);
  });

  it("registers an indoor biome with its own artwork that exits to Slum", () => {
    expect(allBiomes.get(BiomeId.ROCKET_HQ).biomeLinks).toEqual([BiomeId.SLUM]);
    expect(game.scene.arena.isOutside()).toBe(false);
    expect(game.scene.arena.trainerChance).toBe(1);
    expect(getBiomeAssetKey(BiomeId.ROCKET_HQ)).toBe("rocket_hq");
    expect(getBiomeHasProps(BiomeId.ROCKET_HQ)).toBe(true);
    const pools = allBiomes.get(BiomeId.ROCKET_HQ).trainerPool;
    for (const tier of [BiomePoolTier.COMMON, BiomePoolTier.UNCOMMON, BiomePoolTier.RARE]) {
      expect(pools[tier]).toEqual([TrainerType.ROCKET_GRUNT]);
    }
    for (const tier of [BiomePoolTier.SUPER_RARE, BiomePoolTier.ULTRA_RARE]) {
      expect(pools[tier]).toEqual([TrainerType.ARCHER, TrainerType.ARIANA, TrainerType.PROTON, TrainerType.PETREL]);
    }
  });

  it("uses Rocket HQ platforms and independently layered enemy props", () => {
    const player = game.scene.arenaPlayer;
    const enemy = game.scene.arenaEnemy;
    const playerTexture = vi.spyOn(player.base, "setTexture");
    const enemyTexture = vi.spyOn(enemy.base, "setTexture");
    const propTextures = enemy.props.map(prop => vi.spyOn(prop, "setTexture"));
    const propVisibility = enemy.props.map(prop => vi.spyOn(prop, "setVisible"));
    player.setBiome(BiomeId.ROCKET_HQ);
    enemy.setBiome(BiomeId.ROCKET_HQ, 7);
    expect(playerTexture).toHaveBeenCalledWith("rocket_hq_a");
    expect(enemyTexture).toHaveBeenCalledWith("rocket_hq_b");
    propTextures.forEach((texture, index) => {
      expect(texture).toHaveBeenCalledWith(`rocket_hq_b_${index + 1}`);
      expect(propVisibility[index]).toHaveBeenLastCalledWith(true);
    });
    enemy.setBiome(BiomeId.ROCKET_HQ, 2);
    propVisibility.forEach((visibility, index) => expect(visibility).toHaveBeenLastCalledWith(index === 1));
    enemy.setBiome(BiomeId.ROCKET_HQ, 0);
    propVisibility.forEach(visibility => expect(visibility).toHaveBeenLastCalledWith(false));
  });

  it("generates consecutive trainers, including x1 floors and Giovanni on x0 floors", () => {
    const allowed = [
      TrainerType.ROCKET_GRUNT,
      TrainerType.ARCHER,
      TrainerType.ARIANA,
      TrainerType.PROTON,
      TrainerType.PETREL,
    ];
    for (let wave = 31; wave <= 40; wave++) {
      expect(game.scene.gameMode.isWaveTrainer(wave)).toBe(true);
      const type = game.scene.arena.randomTrainerType(wave);
      if (wave === 40) {
        expect(type).toBe(TrainerType.GIOVANNI);
      } else {
        expect(allowed).toContain(type);
      }
    }
    expect(game.scene.gameMode.isTrainerBoss(200, BiomeId.ROCKET_HQ, false)).toBe(false);
  });

  it.each([35, 112, 115, 165, 182, 190, 195])("preserves the scheduled story battle at wave %i", wave => {
    expect(game.scene.gameMode.isFixedBattle(wave)).toBe(true);
    game.scene.currentBattle.waveIndex = wave - 1;
    const fixed = game.scene.gameMode.getFixedBattle(wave)!;
    const getTrainer = vi.spyOn(fixed, "getTrainer");
    const battle = game.scene.newBattle();
    expect(getTrainer).toHaveBeenCalledOnce();
    expect(battle.battleType).toBe(BattleType.TRAINER);
    expect(battle.trainer).toBe(getTrainer.mock.results[0].value);
  });

  it.each([
    TrainerType.ROCKET_GRUNT,
    TrainerType.ARCHER,
    TrainerType.ARIANA,
    TrainerType.PROTON,
    TrainerType.PETREL,
    TrainerType.GIOVANNI,
  ])("scales trainer %i's party levels to the current wave", type => {
    const levels = [33, 153].map(wave => {
      game.scene.currentBattle.waveIndex = wave;
      const trainer = new Trainer(type, TrainerVariant.DEFAULT);
      const result = trainer.getPartyLevels(wave);
      trainer.destroy();
      return result;
    });
    expect(levels[0].length).toBeGreaterThan(0);
    expect(levels[1].length).toBeGreaterThanOrEqual(levels[0].length);
    expect(Math.min(...levels[1])).toBeGreaterThan(Math.max(...levels[0]));
  });

  it.each([1, 2, 3] as const)("offers one exclusive choice to each of %i players, including CPUs", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, count > 1, count);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    const owners = game.scene.getActivePlayerIndexes();
    for (const owner of owners) {
      const pokemon = game.scene.addPlayerPokemon(
        speciesDataRegistry.getSpecies(owner === count - 1 ? SpeciesId.MEWTWO : SpeciesId.PIKACHU),
        50,
      );
      game.scene.getPlayerParty(owner).push(pokemon);
    }
    game.scene.currentBattle.trainer = new Trainer(TrainerType.GIOVANNI, TrainerVariant.DEFAULT);
    const phase = new TrainerVictoryPhase();
    vi.spyOn(phase, "showEnemyTrainer").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    phase.start();
    const rewards = queue.mock.calls.filter(call => call[0] === "SelectModifierPhase");
    expect(rewards).toHaveLength(count);
    for (const owner of owners) {
      const call = rewards.find(args => args[5] === owner)!;
      expect(call[3]).toEqual({
        guaranteedModifierTypeFuncs:
          owner === count - 1 ? [modifierTypes.STRANGE_HELMET, modifierTypes.SILPH_SCOPE] : [modifierTypes.SILPH_SCOPE],
        fillRemaining: false,
        rerollMultiplier: -1,
        allowBonusRewards: false,
      });
    }
  });

  it.each([
    [BiomeId.ROCKET_HQ, TrainerType.ROCKET_BOSS_GIOVANNI_1],
    [BiomeId.ROCKET_HQ, TrainerType.ROCKET_GRUNT],
    [BiomeId.SLUM, TrainerType.GIOVANNI],
  ])("does not award HQ items for biome %i and trainer %i", (biome, trainer) => {
    game.scene.arena = new Arena(biome);
    game.scene.currentBattle.trainer = new Trainer(trainer, TrainerVariant.DEFAULT);
    const phase = new TrainerVictoryPhase();
    vi.spyOn(phase, "showEnemyTrainer").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    phase.start();
    expect(queue.mock.calls.filter(call => call[0] === "SelectModifierPhase")).toHaveLength(0);
  });

  it("keeps bonus rewards and rerolls out of the exclusive selection", () => {
    const phase = new SelectModifierPhase(0, undefined, {
      guaranteedModifierTypeFuncs: [modifierTypes.SILPH_SCOPE],
      fillRemaining: false,
      rerollMultiplier: -1,
      allowBonusRewards: false,
    });
    expect(phase["getModifierCount"]()).toBe(1);
    const options = phase["getModifierTypeOptions"](1);
    expect(options.map(option => option.type.id)).toEqual(["SILPH_SCOPE"]);
    expect(phase["getAlphTileRewardOptions"](1)).toEqual([]);
    expect(phase["getVsEnemyTokenOptions"]()).toEqual([]);
    expect(phase.getRerollCost(false)).toBe(-1);
  });
});
