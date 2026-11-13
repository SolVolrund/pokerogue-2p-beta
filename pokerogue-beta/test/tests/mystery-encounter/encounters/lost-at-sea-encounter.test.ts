import type { BattleScene } from "#app/battle-scene";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { LostAtSeaEncounter } from "#mystery-encounters/lost-at-sea-encounter";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounters";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import { initSceneWithoutEncounterPhase } from "#test/utils/game-manager-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/lostAtSea";
/** Blastoise for surf. Pidgeot for fly. Abra for none. */
const defaultParty = [SpeciesId.BLASTOISE, SpeciesId.PIDGEOT, SpeciesId.ABRA];
const defaultBiome = BiomeId.SEA;
const defaultWave = 33;

describe("Lost at Sea - Mystery Encounter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();

    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
      new Map<BiomeId, MysteryEncounterType[]>([
        [BiomeId.SEA, [MysteryEncounterType.LOST_AT_SEA]],
        [BiomeId.MOUNTAIN, [MysteryEncounterType.MYSTERIOUS_CHALLENGERS]],
      ]),
    );
  });

  it("should have the correct properties", () => {
    expect(LostAtSeaEncounter.encounterType).toBe(MysteryEncounterType.LOST_AT_SEA);
    expect(LostAtSeaEncounter.encounterTier).toBe(MysteryEncounterTier.COMMON);
    expect(LostAtSeaEncounter.dialogue).toBeDefined();
    expect(LostAtSeaEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
    expect(LostAtSeaEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
    expect(LostAtSeaEncounter.dialogue.encounterOptionsDialogue?.description).toBe(`${namespace}:description`);
    expect(LostAtSeaEncounter.dialogue.encounterOptionsDialogue?.query).toBe(`${namespace}:query`);
    expect(LostAtSeaEncounter.options).toHaveLength(4);
  });

  it("should not spawn outside of sea biome", async () => {
    game.override.mysteryEncounterTier(MysteryEncounterTier.COMMON).startingBiome(BiomeId.MOUNTAIN);
    await game.runToMysteryEncounter();

    expect(game.scene.currentBattle.mysteryEncounter?.encounterType).not.toBe(MysteryEncounterType.LOST_AT_SEA);
  });

  it("should initialize fully", () => {
    initSceneWithoutEncounterPhase(scene, defaultParty);
    scene.currentBattle.mysteryEncounter = LostAtSeaEncounter;

    const { onInit } = LostAtSeaEncounter;

    expect(LostAtSeaEncounter.onInit).toBeDefined();

    LostAtSeaEncounter.populateDialogueTokensFromRequirements();
    const onInitResult = onInit!();

    expect(LostAtSeaEncounter.dialogueTokens?.damagePercentage).toBe("25");
    expect(LostAtSeaEncounter.dialogueTokens?.option1RequiredMove).toBe(i18next.t("move:surf.name"));
    expect(LostAtSeaEncounter.dialogueTokens?.option2RequiredMove).toBe(i18next.t("move:fly.name"));
    expect(onInitResult).toBe(true);
  });

  describe("Option 4 - Alto Mare", () => {
    const route = LostAtSeaEncounter.options[3];

    it.each([SpeciesId.TOTODILE, SpeciesId.CROCONAW, SpeciesId.FERALIGATR, SpeciesId.LATIAS, SpeciesId.LATIOS])(
      "accepts species %i without Aqua Jet",
      species => {
        initSceneWithoutEncounterPhase(scene, [species]);
        const [guide] = scene.getPlayerParty();
        guide.moveset = [new PokemonMove(MoveId.TACKLE)];
        expect(route.meetsRequirements()).toBe(true);
        expect(route.primaryPokemon).toBe(guide);
      },
    );

    it("requires Aqua Jet in the moveset for other species and a guide fit for battle", () => {
      initSceneWithoutEncounterPhase(scene, [SpeciesId.BUIZEL]);
      const [guide] = scene.getPlayerParty();
      guide.moveset = [new PokemonMove(MoveId.WATER_GUN)];
      expect(route.meetsRequirements()).toBe(false);
      guide.moveset.push(new PokemonMove(MoveId.AQUA_JET));
      expect(route.meetsRequirements()).toBe(true);
      guide.hp = 0;
      expect(route.meetsRequirements()).toBe(false);
    });

    it("takes both players to Alto Mare when only player two has a guide and chooses the route", async () => {
      initSceneWithoutEncounterPhase(scene, [SpeciesId.ABRA, SpeciesId.BUIZEL]);
      scene.twoPlayerMode = true;
      const guide = scene.getPlayerParty(0).pop()!;
      guide.moveset = [new PokemonMove(MoveId.AQUA_JET)];
      scene.getPlayerParty(1).push(guide);
      const encounter = new MysteryEncounter(LostAtSeaEncounter);
      scene.currentBattle.mysteryEncounter = encounter;
      encounter.misc = {
        choices: [{ playerIndex: 0, optionIndex: 3 }, { playerIndex: 1, optionIndex: 4 }],
      };
      vi.spyOn(EncounterDialogueUtils, "showEncounterText").mockResolvedValue();
      const awardExp = vi.spyOn(EncounterPhaseUtils, "setEncounterExp").mockImplementation(() => {});
      vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle").mockImplementation(() => {});
      const switchBiome = vi.spyOn(scene.phaseManager, "unshiftNew");

      expect(route.meetsRequirements()).toBe(false); // Player one cannot borrow player two's guide.
      await route.onOptionPhase();
      expect(switchBiome).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.ALTO_MARE);
      expect(awardExp).toHaveBeenCalledWith(guide.id, getPokemonSpecies(SpeciesId.LAPRAS).baseExp, true, 1);
    });
  });

  describe("Option 1 - Surf", () => {
    it("should have the correct properties", () => {
      const option1 = LostAtSeaEncounter.options[0];
      expect(option1.optionMode).toBe(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT);
      expect(option1.dialogue).toBeDefined();
      expect(option1.dialogue).toStrictEqual({
        buttonLabel: `${namespace}:option.1.label`,
        disabledButtonLabel: `${namespace}:option.1.labelDisabled`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        disabledButtonTooltip: `${namespace}:option.1.tooltipDisabled`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      });
    });

    it("should award exp to surfable PKM (Blastoise)", async () => {
      const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);
      const party = game.scene.getPlayerParty();
      const blastoise = party.find(pkm => pkm.species.speciesId === SpeciesId.BLASTOISE);
      const expBefore = blastoise!.exp;

      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("ShowPartyExpBarPhase");

      expect(blastoise?.exp).toBe(expBefore + Math.floor((laprasSpecies.baseExp * defaultWave) / 5 + 1));
    });

    it("should leave encounter without battle", async () => {
      game.override.startingWave(33);
      const leaveEncounterWithoutBattleSpy = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);
      await runMysteryEncounterToEnd(game, 1);

      expect(leaveEncounterWithoutBattleSpy).toBeCalled();
    });

    it("should be disabled if no surfable PKM is in party", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, [SpeciesId.ARCANINE]);
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);

      const encounterPhase = scene.phaseManager.getCurrentPhase();
      expect(encounterPhase?.constructor.name).toBe(MysteryEncounterPhase.name);
      const mysteryEncounterPhase = encounterPhase as MysteryEncounterPhase;
      vi.spyOn(mysteryEncounterPhase, "continueEncounter");
      vi.spyOn(mysteryEncounterPhase, "handleOptionSelect");
      vi.spyOn(scene.ui, "playError");

      await runSelectMysteryEncounterOption(game, 1);

      expect(game).toBeAtPhase("MysteryEncounterPhase");
      expect(scene.ui.playError).not.toHaveBeenCalled(); // No error sfx, option is disabled
      expect(mysteryEncounterPhase.handleOptionSelect).not.toHaveBeenCalled();
      expect(mysteryEncounterPhase.continueEncounter).not.toHaveBeenCalled();
    });
  });

  describe("Option 2 - Fly", () => {
    it("should have the correct properties", () => {
      const option2 = LostAtSeaEncounter.options[1];

      expect(option2.optionMode).toBe(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT);
      expect(option2.dialogue).toBeDefined();
      expect(option2.dialogue).toStrictEqual({
        buttonLabel: `${namespace}:option.2.label`,
        disabledButtonLabel: `${namespace}:option.2.labelDisabled`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.tooltipDisabled`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      });
    });

    it("should award exp to flyable PKM (Pidgeot)", async () => {
      const laprasBaseExp = 187;
      const wave = 33;
      game.override.startingWave(wave);

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);
      const party = game.scene.getPlayerParty();
      const pidgeot = party.find(pkm => pkm.species.speciesId === SpeciesId.PIDGEOT);
      const expBefore = pidgeot!.exp;

      await runMysteryEncounterToEnd(game, 2);
      await game.phaseInterceptor.to("ShowPartyExpBarPhase");

      expect(pidgeot!.exp).toBe(expBefore + Math.floor((laprasBaseExp * defaultWave) / 5 + 1));
    });

    it("should leave encounter without battle", async () => {
      game.override.startingWave(33);
      const leaveEncounterWithoutBattleSpy = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);
      await runMysteryEncounterToEnd(game, 2);

      expect(leaveEncounterWithoutBattleSpy).toBeCalled();
    });

    it("should be disabled if no flyable PKM is in party", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, [SpeciesId.ARCANINE]);
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);

      const encounterPhase = scene.phaseManager.getCurrentPhase();
      expect(encounterPhase?.constructor.name).toBe(MysteryEncounterPhase.name);
      const mysteryEncounterPhase = encounterPhase as MysteryEncounterPhase;
      vi.spyOn(mysteryEncounterPhase, "continueEncounter");
      vi.spyOn(mysteryEncounterPhase, "handleOptionSelect");
      vi.spyOn(scene.ui, "playError");

      await runSelectMysteryEncounterOption(game, 2);

      expect(game).toBeAtPhase("MysteryEncounterPhase");
      expect(scene.ui.playError).not.toHaveBeenCalled(); // No error sfx, option is disabled
      expect(mysteryEncounterPhase.handleOptionSelect).not.toHaveBeenCalled();
      expect(mysteryEncounterPhase.continueEncounter).not.toHaveBeenCalled();
    });
  });

  describe("Option 3 - Wander aimlessy", () => {
    it("should have the correct properties", () => {
      const option3 = LostAtSeaEncounter.options[2];

      expect(option3.optionMode).toBe(MysteryEncounterOptionMode.DEFAULT);
      expect(option3.dialogue).toBeDefined();
      expect(option3.dialogue).toStrictEqual({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        selected: [
          {
            text: `${namespace}:option.3.selected`,
          },
        ],
      });
    });

    it("should damage all (allowed in battle) party PKM by 25%", async () => {
      game.override.startingWave(33);

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);

      const party = game.scene.getPlayerParty();
      const abra = party.find(pkm => pkm.species.speciesId === SpeciesId.ABRA)!;
      vi.spyOn(abra, "isAllowedInBattle").mockReturnValue(false);

      await runMysteryEncounterToEnd(game, 3);

      const allowedPkm = party.filter(pkm => pkm.isAllowedInBattle());
      const notAllowedPkm = party.filter(pkm => !pkm.isAllowedInBattle());
      allowedPkm.forEach(pkm =>
        expect(pkm.hp, `${pkm.name} should have receivd 25% damage: ${pkm.hp} / ${pkm.getMaxHp()} HP`).toBe(
          pkm.getMaxHp() - Math.floor(pkm.getMaxHp() * 0.25),
        ),
      );

      notAllowedPkm.forEach(pkm =>
        expect(pkm.hp, `${pkm.name} should be full hp: ${pkm.hp} / ${pkm.getMaxHp()} HP`).toBe(pkm.getMaxHp()),
      );
    });

    it("should leave encounter without battle", async () => {
      game.override.startingWave(33);
      const leaveEncounterWithoutBattleSpy = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await game.runToMysteryEncounter(MysteryEncounterType.LOST_AT_SEA, defaultParty);
      await runMysteryEncounterToEnd(game, 3);

      expect(leaveEncounterWithoutBattleSpy).toBeCalled();
    });
  });
});
