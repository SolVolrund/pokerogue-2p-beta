import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { choosePlannerMove } from "#utils/battle-planner-ai";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Abilities - Illusion with fusions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let updateFusionPalette: Pokemon["updateFusionPalette"];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    // The battle harness normally stubs palette generation; retain the real method for rendering regressions.
    updateFusionPalette = Pokemon.prototype.updateFusionPalette;
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  function fuse(pokemon: Pokemon, speciesId = SpeciesId.ZOROARK): void {
    pokemon.fusionSpecies = getPokemonSpecies(speciesId);
    pokemon.fusionFormIndex = 0;
    pokemon.fusionAbilityIndex = 0;
    pokemon.fusionGender = Gender.FEMALE;
    pokemon.fusionShiny = false;
    pokemon.fusionVariant = 0;
  }

  async function startWithFusion(targetSpecies = SpeciesId.FEEBAS) {
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, targetSpecies);
    const pokemon = game.field.getPlayerPokemon();
    const target = game.scene.getPlayerParty()[1];
    fuse(pokemon);
    game.field.mockAbility(pokemon, AbilityId.ILLUSION);
    return { pokemon, target };
  }

  async function checkBattleIcons(pokemon: Pokemon, shiny: boolean, doubleShiny: boolean) {
    const info = pokemon["battleInfo"];
    const shinyVisibility = vi.spyOn(info["shinyIcon"], "setVisible");
    const donorVisibility = vi.spyOn(info["fusionShinyIcon"], "setVisible");
    const fusionVisibility = vi.spyOn(info["splicedIcon"], "setVisible");
    info.initInfo(pokemon);
    await pokemon.updateInfo(true);
    expect(shinyVisibility).toHaveBeenLastCalledWith(shiny);
    expect(donorVisibility).toHaveBeenLastCalledWith(doubleShiny);
    expect(fusionVisibility).toHaveBeenLastCalledWith(pokemon.isFusion(true));
  }

  it("activates during the summon phase for a fused starter", async () => {
    game.override.ability(AbilityId.ILLUSION).starterFusionSpecies(SpeciesId.BULBASAUR).enableStarterFusion();
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    const target = game.scene.getPlayerParty()[1];
    expect(pokemon.isFusion()).toBe(true);
    expect(pokemon.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
    expect(pokemon.getBattleSpriteKey()).toBe(target.getBattleSpriteKey());
  });

  it("loads an unfused disguise without trying to load a nonexistent donor", async () => {
    const { pokemon, target } = await startWithFusion();
    pokemon.fusionShiny = true;
    pokemon.fusionVariant = 2;
    const realSpecies = pokemon.species;
    const realTypes = pokemon.getTypes();
    const realDonorLoad = vi.spyOn(pokemon.fusionSpecies!, "loadAssets");
    const disguiseLoad = vi.spyOn(target.species, "loadAssets");
    target.gender = Gender.FEMALE;

    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await expect(pokemon.loadAssets(false, true)).resolves.toBeUndefined();

    expect(realDonorLoad).not.toHaveBeenCalled();
    expect(disguiseLoad).toHaveBeenCalledWith(true, target.formIndex, target.shiny, target.variant);
    expect(pokemon.isFusion()).toBe(true);
    expect(pokemon.isFusion(true)).toBe(false);
    expect(pokemon.isFusionShiny(true)).toBe(false);
    expect(pokemon.getFusionVariant(true)).toBe(0);
    expect(pokemon.getVariant(true)).toBe(target.variant);
    expect(pokemon.getBattleSpriteKey()).toBe(target.getBattleSpriteKey());
    expect(pokemon.species).toBe(realSpecies);
    expect(pokemon.getTypes()).toEqual(realTypes);
    expect(pokemon.getTypes({ useIllusion: true })).toEqual(target.getTypes());
    expect(pokemon.getAbility().id).toBe(AbilityId.ILLUSION);
    await checkBattleIcons(pokemon, false, false);
  });

  it("reveals the real fusion and reloads its assets after taking damage", async () => {
    const { pokemon } = await startWithFusion();
    const realKey = pokemon.getBattleSpriteKey();
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    const realDonorLoad = vi.spyOn(pokemon.fusionSpecies!, "loadAssets");
    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();
    await pokemon.loadAssets(false);

    expect(pokemon.summonData.illusion).toBeNull();
    expect(pokemon.isFusion(true)).toBe(true);
    expect(pokemon.getBattleSpriteKey()).toBe(realKey);
    expect(realDonorLoad).toHaveBeenCalled();
  });

  it("can reload real assets without removing an active unfused disguise", async () => {
    const { pokemon, target } = await startWithFusion();
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    const realDonorLoad = vi.spyOn(pokemon.getFusionSpeciesForm(), "loadAssets");
    await expect(pokemon.loadAssets(false)).resolves.toBeUndefined();
    expect(realDonorLoad).toHaveBeenCalled();
    expect(pokemon.getBattleSpriteKey()).toBe(target.getBattleSpriteKey());
    expect(pokemon.isFusion(true)).toBe(false);
  });

  it("refreshes the disguise after resetting summon data", async () => {
    const { pokemon, target } = await startWithFusion();
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    expect(pokemon.getHp(true)).toBe(target.hp);
    pokemon.resetSummonData();
    target.hp = Math.floor(target.hp / 2);
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    expect(pokemon.getHp(true)).toBe(target.hp);
    expect(pokemon.isFusion(true)).toBe(false);
  });

  it("makes the planner evaluate the disguise instead of the real fusion's types", async () => {
    game.override
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.ALAKAZAM)
      .enemyMoveset([MoveId.PSYCHIC, MoveId.SURF]);
    const { pokemon } = await startWithFusion(SpeciesId.BULBASAUR);
    const enemy = game.field.getEnemyPokemon();
    expect(choosePlannerMove(enemy, enemy.getMoveset()).move).toBe(MoveId.SURF);
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    expect(choosePlannerMove(enemy, enemy.getMoveset()).move).toBe(MoveId.PSYCHIC);
  });

  it.each([
    [false, true],
    [true, false],
    [true, true],
  ])("copies fusion appearance with body shiny %s and donor shiny %s", async (shiny, fusionShiny) => {
    const { pokemon, target } = await startWithFusion();
    fuse(target, SpeciesId.PIKACHU);
    target.shiny = shiny;
    target.variant = 1;
    target.fusionShiny = fusionShiny;
    target.fusionVariant = 2;
    target.fusionGender = Gender.MALE;
    const bodyLoad = vi.spyOn(target.species, "loadAssets");
    const donorLoad = vi.spyOn(target.getFusionSpeciesForm(), "loadAssets");

    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);

    expect(bodyLoad).toHaveBeenCalledWith(target.gender === Gender.FEMALE, 0, shiny, 1);
    expect(donorLoad).toHaveBeenCalledWith(false, 0, fusionShiny, 2);
    expect(pokemon.getFusionGender(false, true)).toBe(Gender.MALE);
    expect(pokemon.getFusionGender()).toBe(Gender.FEMALE);
    expect(pokemon.getFusionVariant()).toBe(0);
    expect(pokemon.getFusionVariant(true)).toBe(2);
    expect(pokemon.getBattleSpriteKey()).toBe(target.getBattleSpriteKey());
    expect(pokemon.getFusionBattleSpriteKey()).toBe(target.getFusionBattleSpriteKey());
    expect(pokemon.getFusionBattleSpriteAtlasPath()).toBe(
      target.getFusionSpeciesForm().getSpriteAtlasPath(false, 0, fusionShiny, 2, true),
    );
    expect(pokemon.getFusionIconAtlasKey()).toBe(target.getFusionIconAtlasKey());
    expect(pokemon.getFusionIconId()).toBe(target.getFusionIconId());
    await checkBattleIcons(pokemon, shiny || fusionShiny, shiny && fusionShiny);
  });

  it("supports Illusion as a fusion's passive", async () => {
    const { pokemon } = await startWithFusion();
    game.field.mockAbility(pokemon, AbilityId.BALL_FETCH);
    game.override.passiveAbility(AbilityId.ILLUSION).hasPassiveAbility(true);
    applyAbAttrs("PreSummonAbAttr", { pokemon, passive: true });
    await pokemon.loadAssets(false, true);
    expect(pokemon.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
    expect(pokemon.getAbility().id).toBe(AbilityId.BALL_FETCH);
  });

  it("supports a wild fused opponent's unfused disguise", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getEnemyPokemon();
    fuse(pokemon);
    game.field.mockAbility(pokemon, AbilityId.ILLUSION);
    vi.spyOn(game.scene.arena, "randomSpecies").mockReturnValue(getPokemonSpecies(SpeciesId.BULBASAUR));
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await expect(pokemon.loadAssets(false, true)).resolves.toBeUndefined();
    expect(pokemon.summonData.illusion?.species).toBe(SpeciesId.BULBASAUR);
    expect(pokemon.isFusion(true)).toBe(false);
  });

  it("still breaks a fused opponent's disguise when its ability is suppressed", async () => {
    game.override.moveset(MoveId.GASTRO_ACID);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getEnemyPokemon();
    fuse(pokemon);
    game.field.mockAbility(pokemon, AbilityId.ILLUSION);
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    expect(pokemon.summonData.illusion).not.toBeNull();
    game.move.select(MoveId.GASTRO_ACID);
    await game.toEndOfTurn();
    expect(pokemon.summonData.illusion).toBeNull();
  });

  it("clears the real fusion's palette while wearing an unfused disguise", async () => {
    const { pokemon } = await startWithFusion();
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    for (const sprite of [pokemon.getSprite(), pokemon.getTintSprite()]) {
      sprite!.pipelineData["spriteColors"] = [[1, 2, 3, 255]];
      sprite!.pipelineData["fusionSpriteColors"] = [[4, 5, 6, 255]];
    }
    updateFusionPalette.call(pokemon);
    for (const sprite of [pokemon.getSprite(), pokemon.getTintSprite()]) {
      expect(sprite!.pipelineData["spriteColors"]).toEqual([]);
      expect(sprite!.pipelineData["fusionSpriteColors"]).toEqual([]);
    }
  });

  it.each([false, true])("uses the disguise's fusion palette with real fusion %s", async realFusion => {
    const { pokemon, target } = await startWithFusion();
    if (!realFusion) {
      pokemon.fusionSpecies = null;
    }
    fuse(target, SpeciesId.PIKACHU);
    applyAbAttrs("PreSummonAbAttr", { pokemon });
    await pokemon.loadAssets(false, true);
    const textures = vi.spyOn(game.scene.textures, "get");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([100, 150, 200, 255]) }),
    } as unknown as CanvasRenderingContext2D);
    updateFusionPalette.call(pokemon);
    expect(textures.mock.calls.map(([key]) => key)).toEqual([
      target.getBattleSpriteKey(false),
      target.getBattleSpriteKey(true),
      target.getFusionBattleSpriteKey(false),
      target.getFusionBattleSpriteKey(true),
    ]);
    expect(pokemon.getSprite().pipelineData["fusionSpriteColors"]).not.toHaveLength(0);

    pokemon.breakIllusion();
    await pokemon.loadAssets(false);
    textures.mockClear();
    updateFusionPalette.call(pokemon);
    if (realFusion) {
      expect(textures.mock.calls.map(([key]) => key)).toEqual([
        pokemon.getBattleSpriteKey(false),
        pokemon.getBattleSpriteKey(true),
        pokemon.getFusionBattleSpriteKey(false),
        pokemon.getFusionBattleSpriteKey(true),
      ]);
    } else {
      expect(pokemon.getSprite().pipelineData["fusionSpriteColors"]).toEqual([]);
    }
  });
});
