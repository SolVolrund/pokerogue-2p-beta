import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import { SingleGenerationChallenge } from "#data/challenge";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges, isSingleGenerationChallenge } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TitlePhase } from "#phases/title-phase";
import { achvs } from "#system/achv";
import { ChallengeData } from "#system/challenge-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { GameManager } from "#test/framework/game-manager";
import { RunInfoUiHandler } from "#ui/run-info-ui-handler";
import {
  applyChallenges,
  checkStarterValidForChallenge,
  getChallengesForPlayer,
  getRibbonsToAward,
} from "#utils/challenge-utils";
import {
  createComputerPartnerStarter,
  getComputerPartnerChallengeProfile,
  getComputerPartnerProfile,
  isComputerPartnerCandidateAllowed,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Player-specific Mono Gen", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const ids = [Challenges.SINGLE_GENERATION_P1, Challenges.SINGLE_GENERATION_P2, Challenges.SINGLE_GENERATION_P3];
  const props = { shiny: false, female: false, variant: 0 as const, formIndex: 0 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    ids.forEach((id, index) => game.scene.gameMode.setChallengeValue(id, index + 1));
  });

  function valid(speciesId: SpeciesId, playerIndex: PlayerIndex, soft = false): boolean {
    return checkStarterValidForChallenge(getPokemonSpecies(speciesId), props, soft, playerIndex);
  }

  function addPokemon(speciesId: SpeciesId, playerIndex: PlayerIndex) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 20);
    game.scene.getPlayerParty(playerIndex).push(pokemon);
    return pokemon;
  }

  it("offers three independent generation rows without renumbering existing save IDs", () => {
    const rules = game.scene.gameMode.challenges.filter(c => isSingleGenerationChallenge(c.id));
    expect(rules.map(c => c.id)).toEqual(ids);
    expect(rules.map(c => c.getName())).toEqual(["Mono Gen P1", "Mono Gen P2", "Mono Gen P3"]);
    expect(rules.every(c => c.maxValue === 9)).toBe(true);
    expect(Challenges.SINGLE_GENERATION).toBe(0);
    expect(Challenges.SINGLE_TYPE_P1).toBe(11);
    expect(Challenges.ABILITY_RANDOMIZER).toBe(15);
    expect(valid(SpeciesId.CHARMANDER, 0)).toBe(true);
    expect(valid(SpeciesId.CHARMANDER, 1)).toBe(false);
    expect(valid(SpeciesId.CYNDAQUIL, 1)).toBe(true);
    expect(valid(SpeciesId.TREECKO, 2)).toBe(true);
    game.scene.setActivePlayerIndex(1);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.CYNDAQUIL), props, false)).toBe(true);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.CHARMANDER), props, false)).toBe(false);
  });

  it("allows matching generations and an unrestricted Off seat", () => {
    game.scene.gameMode.setChallengeValue(ids[1], 1);
    game.scene.gameMode.setChallengeValue(ids[2], 0);
    expect(valid(SpeciesId.CHARMANDER, 1)).toBe(true);
    expect(valid(SpeciesId.CYNDAQUIL, 1)).toBe(false);
    expect(valid(SpeciesId.CHARMANDER, 2)).toBe(true);
    expect(valid(SpeciesId.CYNDAQUIL, 2)).toBe(true);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_GENERATION, 2)).toBe(false);
  });

  it("retains evolution-based starter eligibility and scopes generation-four gender restrictions", () => {
    game.scene.gameMode.setChallengeValue(ids[1], 4);
    expect(valid(SpeciesId.RALTS, 1, true)).toBe(true);
    expect(valid(SpeciesId.RALTS, 1)).toBe(false);
    expect(valid(SpeciesId.GALLADE, 1)).toBe(true);
    expect(valid(SpeciesId.RALTS, 0, true)).toBe(false);
    for (const [speciesId, expected] of [
      [SpeciesId.RALTS, DexAttr.MALE],
      [SpeciesId.SNORUNT, DexAttr.FEMALE],
    ] as const) {
      for (const playerIndex of [0, 1, 2] as const) {
        const dexEntry = { ...game.scene.gameData.dexData[speciesId], caughtAttr: DexAttr.MALE | DexAttr.FEMALE };
        applyChallenges(
          ChallengeType.STARTER_SELECT_MODIFY,
          speciesId,
          dexEntry,
          game.scene.gameData.starterData[speciesId],
          playerIndex,
        );
        expect(dexEntry.caughtAttr).toBe(playerIndex === 1 ? expected : DexAttr.MALE | DexAttr.FEMALE);
      }
    }
  });

  it("checks battle eligibility and both fusion halves against the owner, not the UI player", () => {
    const gen1 = addPokemon(SpeciesId.CHARMANDER, 0);
    const gen2 = addPokemon(SpeciesId.CYNDAQUIL, 1);
    const wrongGen = addPokemon(SpeciesId.CHARMANDER, 1);
    const gen3 = addPokemon(SpeciesId.TREECKO, 2);
    game.scene.setActivePlayerIndex(2);
    expect([gen1, gen2, wrongGen, gen3].map(p => p.isAllowedInBattle())).toEqual([true, true, false, true]);
    gen2.fusionSpecies = getPokemonSpecies(SpeciesId.TOTODILE);
    expect(gen2.isAllowedInBattle()).toBe(true);
    gen2.fusionSpecies = getPokemonSpecies(SpeciesId.SQUIRTLE);
    expect(gen2.isAllowedInBattle()).toBe(false);
  });

  it("requires both the owner's generation and type when combined", () => {
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
    expect(valid(SpeciesId.CHARMANDER, 0)).toBe(true);
    expect(valid(SpeciesId.SQUIRTLE, 0)).toBe(false);
    expect(valid(SpeciesId.CYNDAQUIL, 0)).toBe(false);
    expect(valid(SpeciesId.TOTODILE, 1)).toBe(true);
  });

  it("round-trips scoped saves and keeps legacy generation saves shared", () => {
    const saved = JSON.parse(JSON.stringify(game.scene.gameMode.challenges.map(c => new ChallengeData(c))));
    game.scene.gameMode.challenges = saved.map(c => new ChallengeData(c).toChallenge());
    expect(valid(SpeciesId.CYNDAQUIL, 1)).toBe(true);
    expect(valid(SpeciesId.CYNDAQUIL, 0)).toBe(false);
    game.scene.gameMode.challenges = [
      new ChallengeData({ id: Challenges.SINGLE_GENERATION, value: 2, severity: 0 }).toChallenge(),
    ];
    for (const playerIndex of [0, 1, 2] as const) {
      expect(valid(SpeciesId.CYNDAQUIL, playerIndex)).toBe(true);
      expect(valid(SpeciesId.CHARMANDER, playerIndex)).toBe(false);
    }
    expect(game.scene.gameMode.challenges[0].getName()).toBe("Mono Gen");
  });

  it("preserves the legacy setter and query as aliases for every player's generation", () => {
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 9);
    expect(game.scene.gameMode.challenges.filter(c => isSingleGenerationChallenge(c.id)).map(c => c.value)).toEqual([
      9, 9, 9,
    ]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_GENERATION)).toBe(true);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 0);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_GENERATION)).toBe(false);
  });

  it("scopes generation achievements and ribbons to each player", () => {
    const achievements = [achvs.MONO_GEN_ONE_VICTORY, achvs.MONO_GEN_TWO_VICTORY, achvs.MONO_GEN_THREE_VICTORY];
    for (const playerIndex of [0, 1, 2] as const) {
      const rules = getChallengesForPlayer(playerIndex).filter(c => c instanceof SingleGenerationChallenge);
      expect(rules.map(c => c.id)).toEqual([ids[playerIndex]]);
      expect(achievements.map(a => a.validate([rules[0]]))).toEqual([0, 1, 2].map(i => i === playerIndex));
      expect(getRibbonsToAward(playerIndex)).toBe(RibbonData.CLASSIC | (RibbonData.MONO_GEN_1 << BigInt(playerIndex)));
    }
  });

  it("uses P1's generation for shared story opponents regardless of the active UI player", () => {
    game.scene.gameMode.setChallengeValue(ids[1], 4);
    for (const playerIndex of [0, 1, 2] as const) {
      game.scene.setActivePlayerIndex(playerIndex);
      const config = game.scene.gameMode.getFixedBattle(ClassicFixedBossWaves.ELITE_FOUR_1);
      expect(config?.getTrainer().config.trainerType).toBe(TrainerType.LORELEI);
    }
  });

  it("falls back to the first participating player with Mono Gen enabled for shared story opponents", () => {
    game.scene.gameMode.setChallengeValue(ids[0], 0);
    game.scene.gameMode.setChallengeValue(ids[1], 4);
    for (const playerIndex of [0, 1, 2] as const) {
      game.scene.setActivePlayerIndex(playerIndex);
      expect(
        game.scene.gameMode.getFixedBattle(ClassicFixedBossWaves.ELITE_FOUR_1)?.getTrainer().config.trainerType,
      ).toBe(TrainerType.AARON);
    }
    game.scene.gameMode.setChallengeValue(ids[1], 0);
    expect(
      game.scene.gameMode.getFixedBattle(ClassicFixedBossWaves.ELITE_FOUR_1)?.getTrainer().config.trainerType,
    ).toBe(TrainerType.SIDNEY);
  });

  it("ignores unused seats when choosing story opponents", () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode.setChallengeValue(ids[0], 0);
    const unused = game.scene.gameMode.challenges.filter(c => isSingleGenerationChallenge(c.id) && c.value);
    const spies = unused.map(c => vi.spyOn(c, "applyFixedBattle"));
    game.scene.gameMode.getFixedBattle(ClassicFixedBossWaves.ELITE_FOUR_1);
    expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_GENERATION)).toBe(false);
  });

  it("filters CPU starters and recruitment by their own generation, without needing a Monotype rule", () => {
    const profile = {
      ...getComputerPartnerProfile("riley"),
      startingStarters: [
        { speciesId: SpeciesId.CHARMANDER, points: 1 },
        { speciesId: SpeciesId.CYNDAQUIL, points: 1 },
        { speciesId: SpeciesId.TOTODILE, points: 1 },
      ],
    };
    expect(getComputerPartnerChallengeProfile(profile, 1).startingStarters?.map(s => s.speciesId)).toEqual([
      SpeciesId.CYNDAQUIL,
      SpeciesId.TOTODILE,
    ]);
    expect(createComputerPartnerStarter(profile, undefined, 6, 1).every(s => valid(s.speciesId, 1))).toBe(true);
    expect(createComputerPartnerStarter(profile, undefined, 6, 2)).toEqual([]);
    expect(profile.startingStarters).toHaveLength(3);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.TOTODILE), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CHARMANDER), 1)).toBe(false);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P2, PokemonType.WATER + 1);
    expect(getComputerPartnerChallengeProfile(profile, 1).startingStarters?.map(s => s.speciesId)).toEqual([
      SpeciesId.TOTODILE,
    ]);
  });

  it("clears unused seats for solo without losing saved menu settings", () => {
    const title = new TitlePhase();
    title.gameMode = GameModes.CHALLENGE;
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    game.scene.configureTwoPlayerMode(false);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    title.end();
    expect(game.scene.gameMode.challenges.filter(c => isSingleGenerationChallenge(c.id)).map(c => c.value)).toEqual([
      1, 0, 0,
    ]);
    expect(title["selectedChallenges"].find(c => c.id === ids[1])?.value).toBe(2);
  });

  it("blocks a CPU with no eligible generation starters before starting the run", async () => {
    game.scene.gameMode.setChallengeValue(ids[1], 9);
    const title = new TitlePhase();
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    game.scene.setComputerPartnerKey(1, "riley");
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const text = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart");
    const end = vi.spyOn(title, "end").mockImplementation(() => {});
    title["startMultiplayerRun"](GameModes.CHALLENGE, 2, 6, [1]);
    await Promise.resolve();
    expect(text.mock.calls.at(-1)?.[0]).toContain("Riley has no eligible starters for P2's challenge restrictions");
    expect(broadcast).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    game.scene.setComputerPartnerKey(1, "alex");
    expect(title["validateChallengePlayers"](GameModes.CHALLENGE)).toBe(true);
  });

  it("labels the owner in run history while preserving legacy labels", () => {
    const handler = Object.create(RunInfoUiHandler.prototype) as RunInfoUiHandler;
    handler["runInfo"] = {
      challenges: ids.map((id, index) => ({ id, value: index + 1, severity: 0 })),
    } as (typeof handler)["runInfo"];
    expect(handler["challengeParser"]()).toEqual(
      [1, 2, 3].map(gen => `P${gen}: ${i18next.t(`runHistory:challengeMonoGen${gen}`)}`),
    );
    handler["runInfo"].challenges = [new ChallengeData({ id: Challenges.SINGLE_GENERATION, value: 1, severity: 0 })];
    expect(handler["challengeParser"]()).toEqual([i18next.t("runHistory:challengeMonoGen1")]);
  });
});
