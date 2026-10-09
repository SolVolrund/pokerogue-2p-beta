import { readFileSync } from "node:fs";
import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { towerTrainers, towerWildPools, TOWER_GHOST_SPRITE } from "#data/pokemon-tower-encounters";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { GameModes } from "#enums/game-modes";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { trainerConfigs } from "#trainers/trainer-config";
import * as common from "#utils/common";
import { getHauntingSkull, getSpiritCount, grantHauntingVictoryRewards } from "#utils/haunting-utils";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import * as towerUtils from "#utils/pokemon-tower-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Pokemon Tower encounter roster", () => {
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
    game.scene.newArena(BiomeId.POKEMON_TOWER);
    game.scene.seasonalEncounters.enterTower(51);
  });

  it("uses exactly one of six rolls for a trainer floor", () => {
    const roll = vi.spyOn(common, "randSeedInt");
    for (let i = 0; i < 6; i++) {
      roll.mockReturnValueOnce(i);
      expect(towerUtils.rollTowerTrainerEncounter()).toBe(i === 0);
      expect(roll).toHaveBeenLastCalledWith(6);
    }
  });

  it.each([1, 2, 3] as const)("creates wild floors with %i field slots and guaranteed spirits", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    vi.spyOn(towerUtils, "rollTowerTrainerEncounter").mockReturnValue(false);
    let battle = game.scene.newBattle();
    expect(battle.battleType).toBe(BattleType.WILD);
    expect(battle.enemyLevels).toHaveLength(count);
    expect(battle.getBattlerCount()).toBe(count);
    grantHauntingVictoryRewards();
    game.scene.getActivePlayerIndexes().forEach(owner => {
      expect(getHauntingSkull(owner)?.stage).toBe("ominous");
      expect(getSpiritCount(owner)).toBe(0);
    });
    for (let floor = 0; floor < 9; floor++) {
      battle = game.scene.newBattle();
      expect(battle.battleType).toBe(BattleType.WILD);
      grantHauntingVictoryRewards();
    }
    game.scene.getActivePlayerIndexes().forEach(owner => expect(getSpiritCount(owner)).toBe(9));
    expect(game.scene.newBattle().greatHauntState?.stage).toBe("ghost");
  });

  it("retains normal rarity boundaries and downgrades the unused Super Rare tier", () => {
    const roll = vi.spyOn(common, "randSeedInt");
    for (const [value, tier] of [
      [511, BiomePoolTier.COMMON],
      [156, BiomePoolTier.COMMON],
      [155, BiomePoolTier.UNCOMMON],
      [32, BiomePoolTier.UNCOMMON],
      [31, BiomePoolTier.RARE],
      [1, BiomePoolTier.RARE],
      [0, BiomePoolTier.ULTRA_RARE],
    ]) {
      roll.mockReturnValueOnce(value);
      expect(towerWildPools[tier]).toContain(towerUtils.rollTowerWildEntry());
    }
  });

  it("preserves every listed trainer name, team size, nickname, and shared ghost appearance", () => {
    for (const entry of towerTrainers) {
      const config = trainerConfigs[entry.type];
      const trainer = new Trainer(entry.type, TrainerVariant.DEFAULT);
      expect(trainer.getName()).toBe(entry.name);
      expect(config.getSpriteKey()).toBe(TOWER_GHOST_SPRITE);
      expect(config.partyTemplates[0].size).toBe(entry.party.length);
      entry.party.forEach((member, slot) => {
        const pokemon = config.partyMemberFuncs[slot](100, PartyMemberStrength.AVERAGE);
        if (member.nickname) expect(pokemon.getNameToRender()).toBe(member.nickname);
        if (member.fixed) expect(pokemon.species.speciesId).toBe(member.species);
        expect(pokemon.formIndex).toBe(member.formIndex ?? 0);
      });
    }
  });

  it.each([2, 3] as const)("creates independent named trainer parties for %i players", count => {
    game.scene.configureTwoPlayerMode(true, 6, false, count);
    vi.spyOn(towerUtils, "rollTowerTrainerEncounter").mockReturnValue(true);
    const choose = vi.spyOn(game.scene.arena, "randomTrainerType");
    [TrainerType.TOWER_JOEY, TrainerType.TOWER_LOST_SILVER, TrainerType.TOWER_YELLOW]
      .slice(0, count)
      .forEach(type => choose.mockReturnValueOnce(type));
    const battle = game.scene.newBattle();
    expect(battle.enemyLevels).toHaveLength(count === 2 ? 7 : 13);
    for (let i = 0; i < battle.enemyLevels!.length; i++) {
      battle.enemyParty.push(battle.trainer!.genPartyMember(i));
    }
    expect(
      battle.enemyParty
        .filter(p => p.species.speciesId === SpeciesId.UNOWN)
        .map(p => p.formIndex)
        .sort((a, b) => a - b),
    ).toEqual([0, 4, 4, 11, 21]);
    expect(battle.enemyParty.filter(p => p.getNameToRender() === "Top%")).toHaveLength(1);
    expect(battle.trainer?.getName()).toContain("Youngster Joey");
    expect(battle.trainer?.getName()).toContain("...");
    if (count === 3) expect(battle.trainer?.getName()).toContain("Yellow");
  });

  it("locks only Jessica, Top%, and Shedinja while other entries use the evolution resolver", () => {
    const entries = Object.values(towerWildPools).flat();
    expect(
      entries
        .filter(e => e.fixed)
        .map(e => e.nickname ?? SpeciesId[e.species])
        .sort(),
    ).toEqual(["Jessica", "SHEDINJA", "Top%"]);
    for (const entry of entries.filter(e => e.fixed)) {
      for (const level of [1, 100]) expect(towerUtils.resolveTowerSpecies(entry, level)).toBe(entry.species);
    }
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.VENUSAUR }, 5)).toBe(SpeciesId.BULBASAUR);
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.VENUSAUR }, 100)).toBe(SpeciesId.VENUSAUR);
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.CYNDAQUIL }, 100)).not.toBe(SpeciesId.CYNDAQUIL);
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.HISUI_ZOROARK }, 5)).toBe(SpeciesId.HISUI_ZORUA);
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.FROSLASS }, 100)).toBe(SpeciesId.FROSLASS);
    expect(towerUtils.resolveTowerSpecies({ species: SpeciesId.CERULEDGE }, 100)).toBe(SpeciesId.CERULEDGE);
  });

  it("uses ordinary Kyurem and preserves the musical-note nickname", () => {
    for (const entry of towerWildPools[BiomePoolTier.ULTRA_RARE]!) {
      const pokemon = game.scene.addEnemyPokemon(getPokemonSpecies(entry.species), 100, TrainerSlot.NONE);
      towerUtils.applyTowerPokemonIdentity(pokemon, entry);
      expect(pokemon.formIndex).toBe(0);
      if (entry.nickname) expect(pokemon.getNameToRender()).toBe(entry.nickname);
    }
  });

  it("always selects the Great Haunt when players are ready, regardless of the wild roll", () => {
    game.scene.addModifier(getModifierType(modifierTypes.PORTENT_SKULL).newModifier());
    const roll = vi.spyOn(towerUtils, "rollTowerTrainerEncounter").mockReturnValue(false);
    expect(game.scene.newBattle().greatHauntState?.stage).toBe("ghost");
    expect(roll).not.toHaveBeenCalled();
  });

  it("provides exactly the 21 occupied sprite cells in reading order", () => {
    const png = readFileSync(`assets/images/trainer/${TOWER_GHOST_SPRITE}.png`);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([330, 400]);
    const atlas = JSON.parse(readFileSync(`assets/images/trainer/${TOWER_GHOST_SPRITE}.json`, "utf8"));
    expect(atlas.textures[0].frames).toHaveLength(21);
    atlas.textures[0].frames.forEach((frame: any, i: number) => {
      expect(frame.filename).toBe(`${String(i + 1).padStart(4, "0")}.png`);
      expect(frame.frame).toEqual({ x: (i % 5) * 66, y: Math.floor(i / 5) * 80, w: 66, h: 80 });
    });
  });
});
