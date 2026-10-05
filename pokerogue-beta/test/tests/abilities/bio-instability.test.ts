import { BIO_EEVEE_FORM_KEY, BIO_INSTABILITY_FORMS, BIO_INSTABILITY_VARIANT } from "#data/bio-instability";
import { getGameMode } from "#app/game-mode";
import { GameModes } from "#enums/game-modes";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { generateStarters } from "#test/utils/game-manager-utils";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { Pokemon, type PlayerPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import * as ante from "#moves/veevee-ante";
import { GameCornerRewardPhase } from "#phases/game-corner-reward-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Bio-Instability jackpot Eevee", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // The headless sprite mock has no animation frame for accessory rendering.
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

  async function createJackpot(): Promise<PlayerPokemon> {
    await startBattle();
    const pokemon = game.field.getPlayerPokemon();
    pokemon.customPokemonData.eventVariant = BIO_INSTABILITY_VARIANT;
    pokemon.passive = true;
    pokemon.passiveIndex = 0;
    await changeForm(pokemon, BIO_EEVEE_FORM_KEY);
    return pokemon;
  }

  async function startBattle(): Promise<void> {
    await game.runToTitle();
    game.override.shiny(false).enemyShiny(false).playerIVs(31).enemyIVs(31);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const starters = generateStarters(game.scene, [SpeciesId.EEVEE]);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattle(starters);
    await game.phaseInterceptor.to("CommandPhase");
  }

  function changeForm(pokemon: PlayerPokemon, key: string) {
    return pokemon.changeForm(
      new SpeciesFormChange({
        speciesId: SpeciesId.EEVEE,
        preFormKey: pokemon.getFormKey(),
        evoFormKey: key,
        trigger: new SpeciesFormChangeManualTrigger(),
        quiet: true,
      }),
    );
  }

  it("provides the configured four-move loadouts with Ante last in every form", () => {
    expect(BIO_INSTABILITY_FORMS.map(form => form.moves)).toEqual([
      [MoveId.VEEVEE_VOLLEY, MoveId.LAST_RESORT, MoveId.PROTECT, MoveId.VEEVEE_ANTE],
      [MoveId.BOUNCY_BUBBLE, MoveId.AQUA_RING, MoveId.MUDDY_WATER, MoveId.VEEVEE_ANTE],
      [MoveId.BUZZY_BUZZ, MoveId.ELECTRO_BALL, MoveId.ELECTROWEB, MoveId.VEEVEE_ANTE],
      [MoveId.SIZZLY_SLIDE, MoveId.MAGMA_STORM, MoveId.FLARE_BLITZ, MoveId.VEEVEE_ANTE],
      [MoveId.BADDY_BAD, MoveId.POWER_TRIP, MoveId.HONE_CLAWS, MoveId.VEEVEE_ANTE],
      [MoveId.GLITZY_GLOW, MoveId.STORED_POWER, MoveId.CALM_MIND, MoveId.VEEVEE_ANTE],
      [MoveId.FREEZY_FROST, MoveId.SHEER_COLD, MoveId.BLIZZARD, MoveId.VEEVEE_ANTE],
      [MoveId.SAPPY_SEED, MoveId.INGRAIN, MoveId.LEAF_BLADE, MoveId.VEEVEE_ANTE],
      [MoveId.SPARKLY_SWIRL, MoveId.FLORAL_HEALING, MoveId.DAZZLING_GLEAM, MoveId.VEEVEE_ANTE],
    ]);
  });

  it("changes before damage and activates the new passive without replacing the selected attack", async () => {
    const pokemon = await createJackpot();
    const enemy = game.field.getEnemyPokemon();
    const originalHp = enemy.hp;
    const damage = enemy.damageAndUpdate.bind(enemy);
    const apply = vi.spyOn(enemy, "damageAndUpdate").mockImplementation((...args) => {
      expect(pokemon.getFormKey()).toBe("bio-vaporeon");
      expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
      return damage(...args);
    });
    pokemon.moveset = [new PokemonMove(MoveId.BOUNCY_BUBBLE)];
    game.move.select(MoveId.BOUNCY_BUBBLE);
    await game.toNextTurn();
    expect(pokemon.getFormKey()).toBe("bio-vaporeon");
    expect(pokemon.getTypes()).toEqual([PokemonType.WATER]);
    expect(pokemon.getAbility().id).toBe(AbilityId.BIO_INSTABILITY);
    expect(pokemon.getPassiveAbility().id).toBe(AbilityId.DRIZZLE);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
    expect(enemy.hp).toBeLessThan(originalHp);
    expect(apply).toHaveBeenCalled();
    expect(pokemon.getLastXMoves(1)[0].move).toBe(MoveId.BOUNCY_BUBBLE);
    expect(pokemon.moveset.map(move => move.moveId)).toEqual(BIO_INSTABILITY_FORMS[1].moves);
    expect(pokemon.moveset[0].ppUsed).toBe(1);
  });

  it("preserves hidden PP and PP Ups through form cycling, save/load and full recovery", async () => {
    const pokemon = await createJackpot();
    const bubble = pokemon.customPokemonData.bioInstabilityMoves.find(move => move.moveId === MoveId.BOUNCY_BUBBLE)!;
    bubble.ppUp = 2;
    bubble.ppUsed = 7;
    await changeForm(pokemon, "bio-espeon");
    const saved = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(pokemon))));
    const restored = saved.toPokemon() as PlayerPokemon;
    expect(restored.isBioInstabilityEevee()).toBe(true);
    expect(restored.getFormKey()).toBe("bio-espeon");
    await changeForm(restored, "bio-vaporeon");
    expect(restored.moveset[0].ppUsed).toBe(7);
    expect(restored.moveset[0].ppUp).toBe(2);
    await changeForm(restored, "bio-espeon");
    for (const move of restored.getMovesetForPpRestore()) {
      move.ppUsed = 0;
    }
    await changeForm(restored, "bio-vaporeon");
    expect(restored.moveset[0].ppUsed).toBe(0);
    expect(restored.moveset[0].ppUp).toBe(2);
    restored.destroy();
  });

  it("calls every signature with Ante and returns to Eevee using Veevee Volley", async () => {
    const pokemon = await createJackpot();
    const roll = vi.spyOn(ante, "rollVeeveeAnte");
    pokemon.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)!.ppUp = 3;
    game.field.getEnemyPokemon().hp = game.field.getEnemyPokemon().getMaxHp();
    const route: [MoveId, string][] = [
      [MoveId.BOUNCY_BUBBLE, "bio-vaporeon"],
      [MoveId.BUZZY_BUZZ, "bio-jolteon"],
      [MoveId.SIZZLY_SLIDE, "bio-flareon"],
      [MoveId.VEEVEE_VOLLEY, BIO_EEVEE_FORM_KEY],
      [MoveId.GLITZY_GLOW, "bio-espeon"],
      [MoveId.BADDY_BAD, "bio-umbreon"],
      [MoveId.VEEVEE_VOLLEY, BIO_EEVEE_FORM_KEY],
      [MoveId.SPARKLY_SWIRL, "bio-sylveon"],
      [MoveId.FREEZY_FROST, "bio-glaceon"],
      [MoveId.SAPPY_SEED, "bio-leafeon"],
      [MoveId.SPARKLY_SWIRL, "bio-sylveon"],
      [MoveId.VEEVEE_VOLLEY, BIO_EEVEE_FORM_KEY],
    ];
    for (const [moveId, formKey] of route) {
      game.field.getEnemyPokemon().hp = game.field.getEnemyPokemon().getMaxHp();
      roll.mockReturnValue(moveId);
      game.move.select(MoveId.VEEVEE_ANTE);
      await game.toNextTurn();
      expect(pokemon.getFormKey()).toBe(formKey);
      const config = BIO_INSTABILITY_FORMS.find(form => form.key === formKey)!;
      expect(pokemon.getPassiveAbility().id).toBe(config.passive);
      expect(pokemon.moveset.map(move => move.moveId)).toEqual(config.moves);
    }
    expect(pokemon.moveset.find(move => move.moveId === MoveId.VEEVEE_ANTE)?.ppUsed).toBe(route.length);
    expect(
      pokemon.customPokemonData.bioInstabilityMoves
        .filter(move => move.moveId !== MoveId.VEEVEE_ANTE)
        .every(move => move.ppUsed === 0),
    ).toBe(true);
  });

  it("preserves HP proportion, persistent identity and passives after purification", async () => {
    const pokemon = await createJackpot();
    pokemon.setShadowPokemon(true);
    pokemon.hp = Math.floor(pokemon.getMaxHp() / 2);
    const ratio = pokemon.hp / pokemon.getMaxHp();
    await changeForm(pokemon, "bio-vaporeon");
    expect(pokemon.hp / pokemon.getMaxHp()).toBeLessThanOrEqual(ratio);
    expect(pokemon.hp / pokemon.getMaxHp()).toBeGreaterThan(ratio - 0.02);
    pokemon.purifyShadowPokemon();
    expect(pokemon.isBioInstabilityEevee()).toBe(true);
    expect(pokemon.isShadowPokemon()).toBe(false);
    expect(pokemon.isPurifiedPokemon()).toBe(true);
    expect(pokemon.getAbility().id).toBe(AbilityId.BIO_INSTABILITY);
    expect(pokemon.getPassiveAbility().id).toBe(AbilityId.DRIZZLE);
    await changeForm(pokemon, BIO_EEVEE_FORM_KEY);
    expect(pokemon.hp / pokemon.getMaxHp()).toBeLessThanOrEqual(ratio);
  });

  it("gates changing on identity and ability, and ignores unsupported move types", async () => {
    await startBattle();
    const ordinary = game.field.getPlayerPokemon();
    ordinary.customPokemonData.ability = AbilityId.BIO_INSTABILITY;
    expect(ordinary.queueBioInstabilityFormChange(PokemonType.WATER)).toBe(false);
    ordinary.customPokemonData.eventVariant = BIO_INSTABILITY_VARIANT;
    await changeForm(ordinary, BIO_EEVEE_FORM_KEY);
    ordinary.summonData.abilitySuppressed = true;
    expect(ordinary.queueBioInstabilityFormChange(PokemonType.WATER)).toBe(false);
    ordinary.summonData.abilitySuppressed = false;
    expect(ordinary.queueBioInstabilityFormChange(PokemonType.FIGHTING)).toBe(false);
  });

  it("generates the 32-nuggie jackpot with zero friendship without granting dex unlocks", async () => {
    await startBattle();
    const reward = new GameCornerRewardPhase(32);
    const { pokemon: data } = reward["generateShadowPokemonPrize"](9, 10, true);
    const pokemon = data.toPokemon() as PlayerPokemon;
    expect(pokemon.isBioInstabilityEevee()).toBe(true);
    expect(pokemon.isShadowPokemon()).toBe(true);
    expect(pokemon.friendship).toBe(0);
    expect(pokemon.hasPassive()).toBe(true);
    expect(pokemon.moveset.map(move => move.moveId)).toEqual(BIO_INSTABILITY_FORMS[0].moves);
    const dex = { ...game.scene.gameData.dexData[SpeciesId.EEVEE] };
    game.scene.gameData.setPokemonSeen(pokemon);
    await game.scene.gameData.setPokemonCaught(pokemon);
    expect(game.scene.gameData.dexData[SpeciesId.EEVEE]).toEqual(dex);
    expect(pokemon.getEvolution()).toBeNull();
    expect(pokemon.getCompatibleTms()).toEqual([]);
    expect(pokemon.getLevelMoves(1, true, true, true)).toEqual([]);
    for (const config of BIO_INSTABILITY_FORMS) {
      const species = getPokemonSpecies(SpeciesId.EEVEE);
      const index = species.forms.findIndex(form => form.formKey === config.key);
      const form = species.forms[index];
      expect(form.isStarterSelectable).toBe(false);
      expect(form.isUnobtainable).toBe(true);
      expect(species.getIconId(false, index, false, 0)).toBe(
        getPokemonSpecies(config.species).getIconId(false, 0, false, 0),
      );
    }
    pokemon.destroy();
  });
});
