import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { SettingKeys } from "#system/settings/settings";
import { GameManager } from "#test/framework/game-manager";
import { TrainerAceEvCategory, TrainerConfig } from "#trainers/trainer-config";
import {
  TrainerPartyCompoundTemplate,
  TrainerPartyTemplate,
  trainerPartyTemplates,
} from "#trainers/trainer-party-template";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Trainer strength adjustments", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
  });

  afterEach(() => {
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  function configFor(template: TrainerPartyTemplate, type = TrainerType.CYNTHIA): TrainerConfig {
    const config = new TrainerConfig(type).setPartyTemplates(template);
    config.aceEvCategory = TrainerAceEvCategory.CHAMPION;
    // Fixed species isolate trainer levels and Ace assignment from species-pool balancing.
    for (let index = 0; index < template.size; index++) {
      config.setPartyMemberFunc(index, level =>
        game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SNORLAX), level, TrainerSlot.TRAINER),
      );
    }
    return config;
  }

  function makeTrainer(config: TrainerConfig, partner?: TrainerConfig, third?: TrainerConfig): Trainer {
    return new Trainer(
      config.trainerType,
      TrainerVariant.DEFAULT,
      0,
      undefined,
      undefined,
      config,
      undefined,
      undefined,
      partner,
      undefined,
      undefined,
      third,
    );
  }

  function generateParty(trainer: Trainer, waveIndex = 190) {
    const battle = new Battle(game.scene.gameMode, {
      waveIndex,
      battleType: BattleType.TRAINER,
      trainer,
      double: trainer.isDouble(),
    });
    game.scene.currentBattle = battle;
    for (let index = 0; index < battle.enemyLevels!.length; index++) {
      battle.enemyParty.push(trainer.genPartyMember(index));
    }
    return battle.enemyParty;
  }

  it.each([
    [24, [13, 13, 15, 16, 17, 18, 18]],
    [100, [63, 68, 74, 80, 82, 84, 84]],
    [190, [158, 170, 182, 186, 188, 191, 193]],
    [400, [528, 536, 544, 552, 558, 567, 572]],
  ])("uses the new curve for all seven strength tiers at wave %i", (wave, expected) => {
    const template = new TrainerPartyCompoundTemplate(
      ...[
        PartyMemberStrength.WEAKEST,
        PartyMemberStrength.WEAKER,
        PartyMemberStrength.WEAK,
        PartyMemberStrength.AVERAGE,
        PartyMemberStrength.STRONG,
        PartyMemberStrength.STRONGER,
        PartyMemberStrength.STRONGEST,
      ].map(strength => new TrainerPartyTemplate(1, strength)),
    );
    expect(makeTrainer(configFor(template)).getPartyLevels(wave)).toEqual(expected);
  });

  it("uses the mode's difficulty wave, not the displayed wave", () => {
    const difficultyWave = vi.spyOn(game.scene.gameMode, "getWaveForDifficulty").mockReturnValue(190);
    const trainer = makeTrainer(configFor(trainerPartyTemplates.CHAMPION));
    expect(trainer.getPartyLevels(390)).toEqual([188, 188, 188, 188, 191, 193]);
    expect(difficultyWave).toHaveBeenCalledWith(390);
  });

  it.each([
    ["champion", trainerPartyTemplates.CHAMPION, TrainerType.CYNTHIA, 190, [188, 188, 188, 188, 191, 193]],
    ["final rival", trainerPartyTemplates.RIVAL_6, TrainerType.RIVAL_6, 195, [195, 193, 193, 193, 193, 200]],
  ] as const)("keeps six %s Pokemon and makes the last one the Ace", (_label, template, type, wave, levels) => {
    const trainer = makeTrainer(configFor(template, type));
    const party = generateParty(trainer, wave);
    expect(party.map(pokemon => pokemon.level)).toEqual(levels);
    expect(party.map(pokemon => !!pokemon.ace)).toEqual([false, false, false, false, false, true]);
    expect(party[5].aceEvs.reduce((sum, value) => sum + value, 0)).toBe(508);
    expect(trainer.getPartyMemberModifierChanceMultiplier(5)).toBe(0.375);
  });

  describe.each([
    [1, false, false],
    [1, true, false],
    [2, false, false],
    [2, true, false],
    [3, false, false],
    [3, true, false],
    [2, false, true],
    [3, false, true],
  ] as const)("%i players (EP: %s, Vs: %s)", (count, ep, vs) => {
    it.each([0, 2])("preserves independent trainer teams and Aces with party limit %i", limit => {
      game.scene.configureTwoPlayerMode(count > 1 || ep, 6, false, count, [], vs, ep);
      const configs = [TrainerType.CYNTHIA, TrainerType.STEVEN, TrainerType.BLUE]
        .slice(0, count)
        .map(type => configFor(trainerPartyTemplates.CHAMPION, type));
      const trainer = makeTrainer(configs[0], configs[1], configs[2]);
      trainer.setPartyMemberLimitPerTrainer(limit);
      const party = generateParty(trainer);
      const slots = [TrainerSlot.TRAINER, TrainerSlot.TRAINER_PARTNER, TrainerSlot.TRAINER_PARTNER_2].slice(0, count);
      const teamLevels = limit ? [193, 191] : [188, 188, 188, 188, 191, 193];
      expect(party).toHaveLength(teamLevels.length * count);
      expect(party.map(pokemon => pokemon.trainerSlot)).toEqual(teamLevels.flatMap(() => slots));
      for (const slot of slots) {
        const team = party.filter(pokemon => pokemon.trainerSlot === slot);
        expect(team.map(pokemon => pokemon.level)).toEqual(teamLevels);
        const aces = team.filter(pokemon => pokemon.ace);
        expect(aces).toHaveLength(1);
        expect(aces[0].level).toBe(193);
        expect(aces[0].aceEvs.reduce((sum, value) => sum + value, 0)).toBe(508);
        expect(trainer.getPartyMemberModifierChanceMultiplier(party.indexOf(aces[0]))).toBe(0.375);
      }
      trainer.setPartyMemberLimitPerTrainer(0);
      expect(trainer.getPartyLevels(190)).toEqual(
        [188, 188, 188, 188, 191, 193].flatMap(level => slots.map(() => level)),
      );
    });
  });

  it("keeps enemy Ace EV stat bonuses behind the existing setting", () => {
    // The storage mock needs a named property for settings' Object.hasOwn check.
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    const party = generateParty(makeTrainer(configFor(trainerPartyTemplates.CHAMPION)));
    // Trainer IVs are assigned after initial stats; encounters recalculate them before battle.
    for (const pokemon of party) {
      pokemon.calculateStats();
    }
    const ace = party[5];
    const spread = [...ace.aceEvs];
    const disabledStats = [...ace.stats];
    const regularStats = [...party[0].stats];
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 1 }));
    ace.calculateStats();
    party[0].calculateStats();
    expect(ace.stats.some((stat, index) => stat > disabledStats[index])).toBe(true);
    expect(party[0].stats).toEqual(regularStats);
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    ace.calculateStats();
    expect(ace.stats).toEqual(disabledStats);
    expect(ace.aceEvs).toEqual(spread);
  });
});
