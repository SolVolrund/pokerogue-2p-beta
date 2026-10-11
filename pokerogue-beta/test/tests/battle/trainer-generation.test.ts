import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { BattleType } from "#enums/battle-type";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { GameModes } from "#enums/game-modes";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { getRandomPartyMemberFunc, TrainerConfig } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Trainer generation correctness", () => {
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
  });

  function makeTrainer(config: TrainerConfig, variant = TrainerVariant.DEFAULT, partners: TrainerConfig[] = []) {
    return new Trainer(
      config.trainerType,
      variant,
      0,
      undefined,
      undefined,
      config,
      undefined,
      undefined,
      partners[0],
      undefined,
      undefined,
      partners[1],
    );
  }

  function generateParty(trainer: Trainer) {
    const battle = new Battle(game.scene.gameMode, {
      waveIndex: 40,
      battleType: BattleType.TRAINER,
      trainer,
      double: trainer.isDouble(),
    });
    game.scene.currentBattle = battle;
    // Raichu is available to strong trainers at 30, but normal trainers need 35.
    battle.enemyLevels = battle.enemyLevels!.map(() => 30);
    for (let index = 0; index < battle.enemyLevels.length; index++) {
      battle.enemyParty.push(trainer.genPartyMember(index));
    }
    return battle.enemyParty;
  }

  function mixedTemplate(sameSpecies = false) {
    return new TrainerPartyCompoundTemplate(
      new TrainerPartyTemplate(1, PartyMemberStrength.WEAK),
      new TrainerPartyTemplate(
        sameSpecies ? 2 : 1,
        PartyMemberStrength.STRONGER,
        sameSpecies,
        false,
        EvoLevelThresholdKind.STRONG,
      ),
    );
  }

  it("resolves nested evolution thresholds by local template index", () => {
    const template = new TrainerPartyCompoundTemplate(
      new TrainerPartyTemplate(2, PartyMemberStrength.AVERAGE),
      mixedTemplate(),
    );
    expect([0, 1, 2, 3].map(index => template.getEvoThresholdKind(index))).toEqual([
      EvoLevelThresholdKind.NORMAL,
      EvoLevelThresholdKind.NORMAL,
      EvoLevelThresholdKind.NORMAL,
      EvoLevelThresholdKind.STRONG,
    ]);
  });

  describe.each([
    [1, false],
    [1, true],
    [2, false],
    [2, true],
    [3, false],
    [3, true],
  ] as const)("%i players (EP: %s)", (count, ep) => {
    it.each([0, 1])("passes original-slot thresholds to callbacks with team limit %i", limit => {
      game.scene.configureTwoPlayerMode(count > 1 || ep, 6, false, count, [], false, ep);
      const callbacks = Array.from({ length: count }, () => vi.fn(getRandomPartyMemberFunc([SpeciesId.RAICHU])));
      const configs = callbacks.map(callback =>
        new TrainerConfig(TrainerType.YOUNGSTER)
          .setPartyTemplates(mixedTemplate())
          .setPartyMemberFunc(0, callback)
          .setPartyMemberFunc(-1, callback),
      );
      const trainer = makeTrainer(configs[0], TrainerVariant.DEFAULT, configs.slice(1));
      trainer.setPartyMemberLimitPerTrainer(limit);
      const party = generateParty(trainer);
      const slots = [TrainerSlot.TRAINER, TrainerSlot.TRAINER_PARTNER, TrainerSlot.TRAINER_PARTNER_2].slice(0, count);
      expect(party).toHaveLength((limit ? 1 : 2) * count);
      slots.forEach((slot, index) => {
        expect(party.filter(pokemon => pokemon.trainerSlot === slot).map(pokemon => pokemon.species.speciesId)).toEqual(
          limit ? [SpeciesId.RAICHU] : [SpeciesId.PIKACHU, SpeciesId.RAICHU],
        );
        expect(callbacks[index]).toHaveBeenLastCalledWith(
          30,
          PartyMemberStrength.STRONGER,
          EvoLevelThresholdKind.STRONG,
        );
        if (!limit) {
          expect(callbacks[index]).toHaveBeenNthCalledWith(
            1,
            30,
            PartyMemberStrength.WEAK,
            EvoLevelThresholdKind.NORMAL,
          );
        }
      });
    });
  });

  it.each([1, 2, 3] as const)("uses local-slot thresholds for species pools and same-species groups in %ip", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    const configs = Array.from({ length: count }, () =>
      new TrainerConfig(TrainerType.YOUNGSTER)
        .setPartyTemplates(mixedTemplate(true))
        .setSpeciesPools([SpeciesId.RAICHU]),
    );
    const trainer = makeTrainer(configs[0], TrainerVariant.DEFAULT, configs.slice(1));
    const party = generateParty(trainer);
    for (const slot of [TrainerSlot.TRAINER, TrainerSlot.TRAINER_PARTNER, TrainerSlot.TRAINER_PARTNER_2].slice(
      0,
      count,
    )) {
      expect(party.filter(pokemon => pokemon.trainerSlot === slot).map(pokemon => pokemon.species.speciesId)).toEqual([
        SpeciesId.PIKACHU,
        SpeciesId.RAICHU,
        SpeciesId.RAICHU,
      ]);
    }
  });

  it("preserves fixed-form callbacks, post-processing, and trainer ownership", () => {
    const config = new TrainerConfig(TrainerType.YOUNGSTER).setPartyTemplates(mixedTemplate());
    generateParty(makeTrainer(config));
    const species = getPokemonSpecies(SpeciesId.RAICHU);
    const evolution = vi.spyOn(species, "getTrainerSpeciesForLevel");
    const postProcess = vi.fn();
    const callback = getRandomPartyMemberFunc([SpeciesId.RAICHU], TrainerSlot.TRAINER_PARTNER, true, postProcess);
    const pokemon = callback(10, PartyMemberStrength.WEAK, EvoLevelThresholdKind.NORMAL);
    expect(pokemon.species.speciesId).toBe(SpeciesId.RAICHU);
    expect(pokemon.trainerSlot).toBe(TrainerSlot.TRAINER_PARTNER);
    expect(evolution).not.toHaveBeenCalled();
    expect(postProcess).toHaveBeenCalledWith(pokemon);
  });

  it("passes thresholds to scaled double-only callbacks", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const callback = vi.fn(getRandomPartyMemberFunc([SpeciesId.RAICHU]));
    const template = new TrainerPartyTemplate(
      6,
      PartyMemberStrength.STRONG,
      false,
      false,
      EvoLevelThresholdKind.STRONG,
    );
    const config = new TrainerConfig(TrainerType.TWINS)
      .setHasDouble("Twins")
      .setDoubleOnly()
      .setPartyTemplates(template);
    for (let index = 0; index < 3; index++) {
      config.setPartyMemberFunc(index, callback);
    }
    const party = generateParty(makeTrainer(config, TrainerVariant.DOUBLE));
    expect(party.map(pokemon => pokemon.species.speciesId)).toEqual(new Array(6).fill(SpeciesId.RAICHU));
    expect(callback).toHaveBeenCalledTimes(6);
    expect(callback.mock.calls.every(call => call[2] === EvoLevelThresholdKind.STRONG)).toBe(true);
  });

  it.each([
    [2, false],
    [2, true],
    [3, false],
    [3, true],
  ] as const)("pads %i slots without changing later single battles (EP: %s)", (count, ep) => {
    game.scene.configureTwoPlayerMode(count === 3 || ep, 6, false, count === 3 ? 3 : 1, [], false, ep);
    const template = new TrainerPartyTemplate(1, PartyMemberStrength.STRONG, true, true, EvoLevelThresholdKind.STRONG);
    Object.freeze(template);
    const config = new TrainerConfig(TrainerType.YOUNGSTER)
      .setHasDouble("Youngsters")
      .setPartyTemplates(template)
      .setSpeciesPools([SpeciesId.RAICHU]);
    const trainer = makeTrainer(config, TrainerVariant.DOUBLE);
    const party = generateParty(trainer);
    expect(party).toHaveLength(count);
    expect(party.every(pokemon => pokemon.ace && pokemon.species.speciesId === SpeciesId.RAICHU)).toBe(true);
    expect(trainer.getPartyTemplate().size).toBe(count);
    expect(trainer.getPartyTemplate().isSameSpecies(count - 1)).toBe(true);
    expect(trainer.getPartyTemplate().isBalanced(count - 1)).toBe(true);
    expect(config.partyTemplates[0]).toBe(template);
    expect(template.size).toBe(1);
    game.scene.configureTwoPlayerMode(false);
    expect(makeTrainer(config).getPartyLevels(40)).toHaveLength(1);
  });

  it("preserves compound members when padding a dynamic template", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const template = mixedTemplate();
    Object.freeze(template);
    Object.freeze(template.templates);
    const config = new TrainerConfig(TrainerType.YOUNGSTER)
      .setHasDouble("Youngsters")
      .setPartyTemplateFunc(() => template);
    const trainer = makeTrainer(config, TrainerVariant.DOUBLE);
    const expanded = trainer.getPartyTemplate();
    expect(expanded.size).toBe(3);
    expect([0, 1, 2].map(index => expanded.getStrength(index))).toEqual([
      PartyMemberStrength.WEAK,
      PartyMemberStrength.STRONGER,
      PartyMemberStrength.AVERAGE,
    ]);
    expect(expanded.getEvoThresholdKind(1)).toBe(EvoLevelThresholdKind.STRONG);
    expect(template.size).toBe(2);
    expect(template.templates).toHaveLength(2);
    game.scene.configureTwoPlayerMode(false);
    expect(makeTrainer(config).getPartyLevels(40)).toHaveLength(2);
  });

  it("does not pad each independent trainer's one-member team to the total field size", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const template = new TrainerPartyTemplate(1, PartyMemberStrength.STRONG);
    Object.freeze(template);
    const configs = Array.from({ length: 3 }, () =>
      new TrainerConfig(TrainerType.YOUNGSTER)
        .setPartyTemplates(template)
        .setPartyMemberFunc(0, getRandomPartyMemberFunc([SpeciesId.SNORLAX])),
    );
    const trainer = makeTrainer(configs[0], TrainerVariant.DEFAULT, configs.slice(1));
    const party = generateParty(trainer);
    expect(party).toHaveLength(3);
    expect(party.every(pokemon => pokemon.ace)).toBe(true);
    expect(party.map(pokemon => pokemon.trainerSlot)).toEqual([
      TrainerSlot.TRAINER,
      TrainerSlot.TRAINER_PARTNER,
      TrainerSlot.TRAINER_PARTNER_2,
    ]);
    expect(template.size).toBe(1);
  });
});
