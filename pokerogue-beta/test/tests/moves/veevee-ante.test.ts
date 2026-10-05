import { getGameMode } from "#app/game-mode";
import { BIO_EEVEE_FORM_KEY, BIO_INSTABILITY_VARIANT } from "#data/bio-instability";
import { allMoves } from "#data/data-lists";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { Pokemon, type PlayerPokemon } from "#field/pokemon";
import { invalidMetronomeMoves } from "#moves/invalid-moves";
import { PokemonMove } from "#moves/pokemon-move";
import * as ante from "#moves/veevee-ante";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getVeeveeAntePlannerEvaluation } from "#utils/battle-planner-ai";
import { getVeeveeAnteLegacyScore, withBioInstabilityForecast } from "#utils/bio-instability-ai";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("VeeVee-Ante", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(30)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  async function createJackpot(form = BIO_EEVEE_FORM_KEY, double = false): Promise<PlayerPokemon> {
    if (double) {
      game.override.battleStyle("double");
    }
    await game.runToTitle();
    game.override.shiny(false).enemyShiny(false).playerIVs(31).enemyIVs(31);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const starters = generateStarters(game.scene, double ? [SpeciesId.EEVEE, SpeciesId.BULBASAUR] : [SpeciesId.EEVEE]);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattle(starters);
    await game.phaseInterceptor.to("CommandPhase");
    const pokemon = game.field.getPlayerPokemon();
    pokemon.customPokemonData.eventVariant = BIO_INSTABILITY_VARIANT;
    pokemon.passive = true;
    pokemon.passiveIndex = 0;
    await pokemon.changeForm(
      new SpeciesFormChange({
        speciesId: SpeciesId.EEVEE,
        preFormKey: pokemon.getFormKey(),
        evoFormKey: form,
        trigger: new SpeciesFormChangeManualTrigger(),
        quiet: true,
      }),
    );
    return pokemon;
  }

  it.each([
    [PokemonType.NORMAL, ["random", "eevee"]],
    [PokemonType.ELECTRIC, ["defensive", "random", "eevee"]],
    [PokemonType.POISON, ["offensive", "random", "eevee"]],
    [PokemonType.FIRE, ["offensive", "defensive", "random", "eevee"]],
  ])("removes empty categories against type %s", async (type, kinds) => {
    await createJackpot();
    expect(ante.getVeeveeAnteBuckets([type as PokemonType]).map(bucket => bucket.kind)).toEqual(kinds);
    const outcomes = ante.getVeeveeAnteOutcomes([type as PokemonType]);
    expect(outcomes.reduce((total, outcome) => total + outcome.probability, 0)).toBeCloseTo(1);
    expect(outcomes.find(outcome => outcome.move === MoveId.VEEVEE_VOLLEY)?.probability).toBeCloseTo(1 / kinds.length);
  });

  it("uses full dual typing and retains probability from duplicate categories", async () => {
    await createJackpot();
    const buckets = ante.getVeeveeAnteBuckets([PokemonType.ROCK, PokemonType.GROUND]);
    expect(buckets.find(bucket => bucket.kind === "offensive")?.moves).toEqual([
      MoveId.BOUNCY_BUBBLE,
      MoveId.SAPPY_SEED,
    ]);
    expect(buckets.find(bucket => bucket.kind === "defensive")?.moves).toEqual([MoveId.SAPPY_SEED]);
    const outcomes = ante.getVeeveeAnteOutcomes([PokemonType.ROCK, PokemonType.GROUND]);
    expect(outcomes.find(outcome => outcome.move === MoveId.SAPPY_SEED)?.probability).toBeCloseTo(
      1 / 8 + 1 / 4 + 1 / 32,
    );
    expect(outcomes.find(outcome => outcome.move === MoveId.VEEVEE_VOLLEY)?.probability).toBe(1 / 4);
  });

  it("forecasts without rolling, and rolls category before candidate", async () => {
    const pokemon = await createJackpot();
    const target = game.field.getEnemyPokemon();
    vi.spyOn(target, "getTypes").mockReturnValue([PokemonType.NORMAL]);
    const rng = vi.spyOn(pokemon, "randBattleSeedInt").mockReturnValueOnce(0).mockReturnValueOnce(7);
    ante.getVeeveeAnteOutcomes([PokemonType.NORMAL]);
    expect(rng).not.toHaveBeenCalled();
    expect(ante.rollVeeveeAnte(pokemon, target)).toBe(MoveId.SPARKLY_SWIRL);
    expect(rng.mock.calls).toEqual([[2], [8]]);
    expect(invalidMetronomeMoves.has(MoveId.VEEVEE_ANTE)).toBe(true);
    expect(allMoves[MoveId.VEEVEE_ANTE].pp).toBe(10);
    expect(allMoves[MoveId.VEEVEE_ANTE].name).toBe("VeeVee-Ante");
  });

  it("changes directly to the called form and activates its passive before damage", async () => {
    const pokemon = await createJackpot("bio-flareon");
    const target = game.field.getEnemyPokemon();
    vi.spyOn(ante, "rollVeeveeAnte").mockReturnValue(MoveId.BOUNCY_BUBBLE);
    const formChange = vi.spyOn(pokemon, "changeForm");
    const damage = target.damageAndUpdate.bind(target);
    const hit = vi.spyOn(target, "damageAndUpdate").mockImplementation((...args) => {
      expect(pokemon.getFormKey()).toBe("bio-vaporeon");
      expect(game.scene.arena.weatherType).toBe(WeatherType.RAIN);
      return damage(...args);
    });
    game.move.select(MoveId.VEEVEE_ANTE);
    await game.toNextTurn();
    expect(hit).toHaveBeenCalled();
    expect(formChange).toHaveBeenCalledTimes(1);
    expect(pokemon.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)?.ppUsed).toBe(1);
    expect(pokemon.moveset.find(move => move.moveId === MoveId.BOUNCY_BUBBLE)?.ppUsed).toBe(0);
  });

  it("does not reactivate the current form or transform with a suppressed ability", async () => {
    const pokemon = await createJackpot("bio-vaporeon");
    const roll = vi.spyOn(ante, "rollVeeveeAnte").mockReturnValue(MoveId.BOUNCY_BUBBLE);
    const formChange = vi.spyOn(pokemon, "changeForm");
    game.move.select(MoveId.VEEVEE_ANTE);
    await game.toNextTurn();
    expect(formChange).not.toHaveBeenCalled();
    pokemon.summonData.abilitySuppressed = true;
    roll.mockReturnValue(MoveId.SIZZLY_SLIDE);
    game.move.select(MoveId.VEEVEE_ANTE);
    await game.toNextTurn();
    expect(formChange).not.toHaveBeenCalled();
    expect(pokemon.getFormKey()).toBe("bio-vaporeon");
    expect(pokemon.getLastXMoves(1)[0].move).toBe(MoveId.SIZZLY_SLIDE);
  });

  it("keeps the selected opponent in a double battle", async () => {
    const pokemon = await createJackpot("bio-flareon", true);
    const left = game.scene.getField()[BattlerIndex.ENEMY];
    const right = game.scene.getField()[BattlerIndex.ENEMY_2];
    const leftHp = left.hp;
    const rightHp = right.hp;
    const roll = vi.spyOn(ante, "rollVeeveeAnte").mockReturnValue(MoveId.BOUNCY_BUBBLE);
    game.scene.getField()[BattlerIndex.PLAYER_2].moveset = [new PokemonMove(MoveId.SPLASH)];
    game.move.select(MoveId.VEEVEE_ANTE, 0, BattlerIndex.ENEMY_2);
    game.move.select(MoveId.SPLASH, 1);
    await game.toNextTurn();
    expect(roll).toHaveBeenCalledWith(pokemon, right);
    expect(left.hp).toBe(leftHp);
    expect(right.hp).toBeLessThan(rightHp);
  });

  it("obeys Taunt and exhausted PP without rolling or transforming", async () => {
    const pokemon = await createJackpot();
    const move = pokemon.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)!;
    move.ppUsed = 10;
    expect(move.isUsable(pokemon)[0]).toBe(false);
    move.ppUsed = 0;
    pokemon.addTag(BattlerTagType.TAUNT, 3);
    expect(move.isUsable(pokemon, false, true)[0]).toBe(false);
    const roll = vi.spyOn(ante, "rollVeeveeAnte");
    pokemon.moveset = [move];
    game.move.select(MoveId.VEEVEE_ANTE);
    await game.toNextTurn();
    expect(roll).not.toHaveBeenCalled();
    expect(pokemon.getFormKey()).toBe(BIO_EEVEE_FORM_KEY);
    expect(move.ppUsed).toBe(0);
  });

  it("replays the same outcomes from the same battle seed", async () => {
    const pokemon = await createJackpot();
    const target = game.field.getEnemyPokemon();
    const battle = game.scene.currentBattle;
    const seed = battle["battleSeedState"];
    const first = Array.from({ length: 32 }, () => ante.rollVeeveeAnte(pokemon, target));
    battle["battleSeedState"] = seed;
    expect(Array.from({ length: 32 }, () => ante.rollVeeveeAnte(pokemon, target))).toEqual(first);
  });

  it("updates old saves and keeps shared Ante PP through save/load", async () => {
    const pokemon = await createJackpot("bio-vaporeon");
    const bubble = pokemon.moveset[0];
    bubble.ppUsed = 7;
    pokemon.moveset = [
      bubble,
      new PokemonMove(MoveId.AQUA_RING),
      new PokemonMove(MoveId.BUZZY_BUZZ),
      new PokemonMove(MoveId.VEEVEE_VOLLEY),
    ];
    pokemon.customPokemonData.bioInstabilityMoves = [...pokemon.moveset];
    const restored = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(pokemon)))).toPokemon() as PlayerPokemon;
    expect(restored.moveset.map(move => move.moveId)).toEqual([
      MoveId.BOUNCY_BUBBLE,
      MoveId.AQUA_RING,
      MoveId.MUDDY_WATER,
      MoveId.VEEVEE_ANTE,
    ]);
    expect(restored.moveset[0].ppUsed).toBe(7);
    const shared = restored.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)!;
    shared.ppUsed = 6;
    shared.ppUp = 2;
    const reloaded = new PokemonData(
      JSON.parse(JSON.stringify(new PokemonData(restored))),
    ).toPokemon() as PlayerPokemon;
    const reloadedAnte = reloaded.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)!;
    expect(reloadedAnte.ppUsed).toBe(6);
    expect(reloadedAnte.ppUp).toBe(2);
    restored.destroy();
    reloaded.destroy();
  });

  it("projects form stats and passives, restoring the state even after an exception", async () => {
    const pokemon = await createJackpot();
    pokemon.setShadowPokemon(true);
    const stats = pokemon.stats;
    const hp = pokemon.hp;
    const weather = game.scene.arena.weather;
    expect(() =>
      withBioInstabilityForecast(pokemon, allMoves[MoveId.BOUNCY_BUBBLE], () => {
        expect(pokemon.getFormKey()).toBe("bio-vaporeon");
        expect(pokemon.stats[Stat.SPATK]).toBeGreaterThan(stats[Stat.SPATK]);
        expect(game.scene.arena.weatherType).toBe(WeatherType.RAIN);
        throw new Error("forecast interrupted");
      }),
    ).toThrow("forecast interrupted");
    expect(pokemon.getFormKey()).toBe(BIO_EEVEE_FORM_KEY);
    expect(pokemon.stats).toBe(stats);
    expect(pokemon.hp).toBe(hp);
    expect(game.scene.arena.weather).toBe(weather);
  });

  it.each([AiType.PLANNER, AiType.SMART])("allows shadow AI %s to value Ante without rolling its result", async ai => {
    const pokemon = await createJackpot();
    pokemon.setShadowPokemon(true);
    pokemon.moveset = [
      pokemon.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)!,
      new PokemonMove(MoveId.SPLASH),
    ];
    game.scene.plannerAiEnabled = true;
    pokemon.aiType = ai;
    const target = game.field.getEnemyPokemon();
    const roll = vi.spyOn(ante, "rollVeeveeAnte");
    const rng = vi.spyOn(game.scene, "randBattleSeedInt");
    const snapshot = JSON.stringify(new PokemonData(pokemon));
    const weather = game.scene.arena.weather;
    const terrain = game.scene.arena.terrain;
    expect(getVeeveeAnteLegacyScore(pokemon, target)).toBeGreaterThan(0);
    expect(getVeeveeAntePlannerEvaluation(pokemon, target).score).toBeGreaterThan(0);
    expect(rng).not.toHaveBeenCalled();
    expect(JSON.stringify(new PokemonData(pokemon))).toBe(snapshot);
    expect(game.scene.arena.weather).toBe(weather);
    expect(game.scene.arena.terrain).toBe(terrain);
    // Force the normal AI's ranking roll to select its highest-scoring move.
    rng.mockReturnValue(0);
    expect(pokemon.getNextMove().move).toBe(MoveId.VEEVEE_ANTE);
    expect(roll).not.toHaveBeenCalled();
  });

  it("does not credit a defensive transformation before a faster knockout", async () => {
    const pokemon = await createJackpot();
    const target = game.field.getEnemyPokemon();
    game.override.enemyMoveset(MoveId.TACKLE);
    target.setStat(Stat.ATK, 1000);
    target.setStat(Stat.SPD, 1000);
    pokemon.hp = 1;
    expect(getVeeveeAntePlannerEvaluation(pokemon, target).score).toBeLessThan(0);
    expect(pokemon.hp).toBe(1);
    expect(pokemon.getFormKey()).toBe(BIO_EEVEE_FORM_KEY);
  });
});
