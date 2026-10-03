import { AbilityId } from "#enums/ability-id";
import { MeloettaFormChangePostMoveTrigger } from "#data/form-change-triggers";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { Pokemon } from "#field/pokemon";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Relic Song", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Headless sprites have no animation frames for the accessory renderer.
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .moveset([MoveId.RELIC_SONG, MoveId.SPLASH])
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100);
  });

  it("swaps Meloetta's form between Aria and Pirouette", async () => {
    await game.classicMode.startBattle(SpeciesId.MELOETTA);

    const meloetta = game.field.getPlayerPokemon();

    game.move.select(MoveId.RELIC_SONG);
    await game.toNextTurn();

    expect(meloetta.formIndex).toBe(1);

    game.move.select(MoveId.RELIC_SONG);
    await game.phaseInterceptor.to("BerryPhase");

    expect(meloetta.formIndex).toBe(0);
  });

  it("swaps both ways during a Normal monotype challenge", async () => {
    game.challengeMode.addChallenge(Challenges.SINGLE_TYPE, PokemonType.NORMAL + 1, 0);
    await game.challengeMode.startBattle(SpeciesId.MELOETTA);

    const meloetta = game.field.getPlayerPokemon();
    game.move.select(MoveId.RELIC_SONG);
    await game.toNextTurn();
    expect(meloetta.formIndex).toBe(1);

    game.move.select(MoveId.RELIC_SONG);
    await game.phaseInterceptor.to("BerryPhase");
    expect(meloetta.formIndex).toBe(0);
  });

  it.each([
    { type: PokemonType.PSYCHIC, form: 0 },
    { type: PokemonType.FIGHTING, form: 1 },
  ])("preserves monotype $type by keeping form $form", async ({ type, form }) => {
    game.override.starterForms({ [SpeciesId.MELOETTA]: form });
    game.challengeMode.addChallenge(Challenges.SINGLE_TYPE, type + 1, 0);
    await game.challengeMode.startBattle(SpeciesId.MELOETTA);

    const meloetta = game.field.getPlayerPokemon();

    expect(meloetta.formIndex).toBe(form);

    game.move.select(MoveId.RELIC_SONG);
    await game.phaseInterceptor.to("BerryPhase");
    await game.toNextTurn();

    expect(meloetta.formIndex).toBe(form);
  });

  it.each([1, 2] as const)("checks player index %i's monotype instead of the active player's", async owner => {
    await game.classicMode.startBattle(SpeciesId.MELOETTA);
    const meloetta = game.field.getPlayerPokemon();
    game.move.select(MoveId.RELIC_SONG);
    await game.toNextTurn();

    const challengeId = owner === 1 ? Challenges.SINGLE_TYPE_P2 : Challenges.SINGLE_TYPE_P3;
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.PSYCHIC + 1);
    game.scene.gameMode.setChallengeValue(challengeId, PokemonType.NORMAL + 1);
    game.scene.activePlayerIndex = 0;
    vi.spyOn(game.scene, "getPlayerIndexForPokemon").mockReturnValue(owner);
    const trigger = new MeloettaFormChangePostMoveTrigger(MoveId.RELIC_SONG);
    expect(trigger.canChange(meloetta)).toBe(true);

    game.scene.gameMode.setChallengeValue(challengeId, PokemonType.FIGHTING + 1);
    expect(trigger.canChange(meloetta)).toBe(false);
  });

  it("still prevents the change with Sheer Force in a Normal monotype run", async () => {
    game.override.ability(AbilityId.SHEER_FORCE);
    game.challengeMode.addChallenge(Challenges.SINGLE_TYPE, PokemonType.NORMAL + 1, 0);
    await game.challengeMode.startBattle(SpeciesId.MELOETTA);
    const meloetta = game.field.getPlayerPokemon();
    game.move.select(MoveId.RELIC_SONG);
    await game.toNextTurn();
    expect(meloetta.formIndex).toBe(0);
  });

  it("doesn't swap Meloetta's form during biome change (arena reset)", async () => {
    game.override.starterForms({ [SpeciesId.MELOETTA]: 1 }).startingWave(10);
    await game.classicMode.startBattle(SpeciesId.MELOETTA);

    const meloetta = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();

    expect(meloetta.formIndex).toBe(1);
  });
});
