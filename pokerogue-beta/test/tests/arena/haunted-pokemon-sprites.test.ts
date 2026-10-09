import { FieldSpritePipeline } from "#app/pipelines/field-sprite";
import { SpritePipeline } from "#app/pipelines/sprite";
import { modifierTypes } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import type { HauntingSkullModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import shader from "../../../src/pipelines/glsl/sprite-frag-shader.frag?raw";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Haunted battle sprite grayscale", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let pipeline: SpritePipeline;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    vi.spyOn(FieldSpritePipeline.prototype, "onBind").mockImplementation(() => {});
    pipeline = Object.create(SpritePipeline.prototype);
    Object.assign(pipeline, {
      game: { getTime: () => 0, textures: { get: () => ({ source: [] }) } },
      set1f: vi.fn().mockReturnThis(),
      set2f: vi.fn().mockReturnThis(),
      set3fv: vi.fn().mockReturnThis(),
      set4fv: vi.fn().mockReturnThis(),
      set4iv: vi.fn().mockReturnThis(),
      setBoolean: vi.fn().mockReturnThis(),
    });
  });

  function bind(parent?: Pokemon, tone = [0, 0, 0, 0]) {
    const sprite = {
      parentContainer: parent ?? { x: 0, y: 0, scale: 1 },
      pipelineData: { tone, ignoreFieldPos: true },
      width: 16,
      height: 16,
      originY: 1,
      x: 0,
      y: 0,
      frame: { width: 16, height: 16, x: 0, u0: 0, v0: 0 },
      texture: { source: [{ width: 16, height: 16 }] },
    } as unknown as Phaser.GameObjects.Sprite;
    pipeline.onBind(sprite);
    return vi.mocked(pipeline.set4fv).mock.calls.findLast(call => call[0] === "tone")![1];
  }

  function enemy() {
    return game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.GENGAR), 20, TrainerSlot.NONE);
  }

  it("fully desaturates Haunted Pokemon without mutating animation tone data", () => {
    const pokemon = enemy();
    pokemon.haunted = true;
    const animationTone = [12, -5, 8, 0.25];
    expect(bind(pokemon, animationTone)).toEqual([12, -5, 8, 1]);
    expect(animationTone).toEqual([12, -5, 8, 0.25]);
    expect(bind(pokemon)).toEqual([0, 0, 0, 1]);
  });

  it("leaves ordinary Pokemon and UI sprites unchanged, without leaking the previous sprite's grayscale", () => {
    const pokemon = enemy();
    pokemon.haunted = true;
    bind(pokemon);
    expect(bind()).toEqual([0, 0, 0, 0]);
    pokemon.haunted = false;
    expect(bind(pokemon, [3, 4, 5, 0.2])).toEqual([3, 4, 5, 0.2]);
  });

  it("only desaturates naturally Haunted party members, not ordinary Malefic Skull owners", () => {
    game.scene.configureTwoPlayerMode(true);
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20);
    game.scene.getPlayerParty(0).push(pokemon);
    expect(bind(pokemon)).toEqual([0, 0, 0, 0]);
    game.scene.getPlayerModifiers(0).push(getModifierType(modifierTypes.MALEFIC_SKULL).newModifier() as HauntingSkullModifier);
    expect(bind(pokemon)).toEqual([0, 0, 0, 0]);
    pokemon.setHaunted();
    expect(bind(pokemon)).toEqual([0, 0, 0, 1]);
    game.scene.getPlayerParty(0).splice(0, 1);
    game.scene.getPlayerParty(1).push(pokemon);
    expect(bind(pokemon)).toEqual([0, 0, 0, 1]);
  });

  it("retains crystal rendering while applying grayscale after its colors and before environmental lighting", () => {
    const pokemon = enemy();
    pokemon.haunted = true;
    pokemon.crystalized = true;
    expect(bind(pokemon)).toEqual([0, 0, 0, 1]);
    expect(pipeline.set3fv).toHaveBeenCalledWith(
      "crystalColor",
      pokemon.getCrystalColor().map(c => c / 255),
    );
    expect(shader.indexOf("/* Apply gray */")).toBeGreaterThan(shader.indexOf("vec3 crystalRgb"));
    expect(shader.indexOf("/* Apply gray */")).toBeLessThan(shader.indexOf("/* Apply day/night tint */"));
  });
});
