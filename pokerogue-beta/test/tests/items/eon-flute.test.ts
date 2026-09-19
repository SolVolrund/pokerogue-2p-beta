import { Battle } from "#app/battle";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { SpeciesId } from "#enums/species-id";
import { EonFluteModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Eon Flute", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.ability(AbilityId.BALL_FETCH);
  });

  it.each([
    { wave: 20, multiLens: 0, leftovers: 1, shellBell: 0 },
    { wave: 40, multiLens: 1, leftovers: 0, shellBell: 0 },
    { wave: 60, multiLens: 1, leftovers: 1, shellBell: 0 },
    { wave: 200, multiLens: 1, leftovers: 2, shellBell: 1 },
  ])("creates a helper with the correct loadout at wave $wave", ({ wave, multiLens, leftovers, shellBell }) => {
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.WILD,
      double: false,
    });
    const faintedPokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 5);
    faintedPokemon.hp = 0;
    game.scene.getPlayerParty(0).push(faintedPokemon);
    game.scene.getPlayerModifiers(0).push(new EonFluteModifier(modifierTypes.EON_FLUTE()));

    expect(game.scene.hasPlayerUsablePokemon(0)).toBe(false);
    expect(game.scene.hasEonFluteProtection(0)).toBe(true);

    const guest = game.scene.createEonFluteGuest(0);
    const items = game.scene
      .getPlayerModifiers(0)
      .filter(
        (modifier): modifier is PokemonHeldItemModifier =>
          modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === guest.id,
      );
    const itemCount = (id: string) =>
      items.filter(modifier => modifier.type.id === id).reduce((count, modifier) => count + modifier.stackCount, 0);

    expect([SpeciesId.LATIAS, SpeciesId.LATIOS]).toContain(guest.species.speciesId);
    expect(guest.isFainted()).toBe(false);
    expect(game.scene.getEonFluteGuest(0)).toBe(guest);
    expect(game.scene.hasEonFluteSummonedThisBattle(0)).toBe(true);
    expect(itemCount("MULTI_LENS")).toBe(multiLens);
    expect(itemCount("LEFTOVERS")).toBe(leftovers);
    expect(itemCount("SHELL_BELL")).toBe(shellBell);
    expect(items.every(modifier => modifier.eonFluteGuestItem && !modifier.isTransferable)).toBe(true);

    expect(game.scene.createEonFluteGuest(0)).toBe(guest);
    expect(game.scene.getPlayerModifiers(0).filter(modifier => modifier instanceof PokemonHeldItemModifier)).toEqual(
      items,
    );
  });
});
