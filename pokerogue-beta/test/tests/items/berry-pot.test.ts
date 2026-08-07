import { AbilityId } from "#enums/ability-id";
import { modifierTypes } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { ModifierTypeOption } from "#modifiers/modifier-type";
import { BerryModifier, BerryPotModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Berry Pot", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.SYMBIOSIS)
      .enemyAbility(AbilityId.UNNERVE)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SHUCKLE);
  });

  it("grows a berry every 5 waves with one stack", async () => {
    game.override.startingHeldItems([{ name: "BERRY_POT", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const berryPot = player.getHeldItems().find(item => item instanceof BerryPotModifier) as BerryPotModifier;

    for (let i = 0; i < 4; i++) {
      expect(berryPot.tryGrowBerry(player)).toBe(false);
    }

    expect(berryPot.tryGrowBerry(player)).toBe(true);
    expect(player.getHeldItems().some(item => item instanceof BerryModifier)).toBe(true);
  });

  it("grows a berry every wave with five stacks", async () => {
    game.override.startingHeldItems([{ name: "BERRY_POT", count: 5 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const berryPot = player.getHeldItems().find(item => item instanceof BerryPotModifier) as BerryPotModifier;

    expect(berryPot.tryGrowBerry(player)).toBe(true);
    expect(player.getHeldItems().filter(item => item instanceof BerryModifier)).toHaveLength(1);
  });

  it("cannot be held by Pokemon without Symbiosis", async () => {
    game.override.ability(AbilityId.UNNERVE).startingHeldItems([{ name: "BERRY_POT", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const berryPot = player.getHeldItems().find(item => item.type.id === "BERRY_POT") as BerryPotModifier;

    expect(berryPot.getMaxHeldItemCount(player)).toBe(0);
    expect(berryPot.tryGrowBerry(player)).toBe(false);
    expect(player.getHeldItems().some(item => item instanceof BerryModifier)).toBe(false);
  });

  it("does not grow capped berries", async () => {
    game.override.startingHeldItems([
      { name: "BERRY_POT", count: 5 },
      { name: "BERRY", type: BerryType.SITRUS, count: 2 },
      { name: "BERRY", type: BerryType.LUM, count: 2 },
      { name: "BERRY", type: BerryType.ENIGMA, count: 2 },
      { name: "BERRY", type: BerryType.LIECHI, count: 3 },
      { name: "BERRY", type: BerryType.GANLON, count: 3 },
      { name: "BERRY", type: BerryType.PETAYA, count: 3 },
      { name: "BERRY", type: BerryType.APICOT, count: 3 },
      { name: "BERRY", type: BerryType.SALAC, count: 3 },
      { name: "BERRY", type: BerryType.LANSAT, count: 3 },
      { name: "BERRY", type: BerryType.STARF, count: 3 },
      { name: "BERRY", type: BerryType.LEPPA, count: 2 },
      { name: "BERRY", type: BerryType.OCCA, count: 3 },
      { name: "BERRY", type: BerryType.PASSHO, count: 3 },
      { name: "BERRY", type: BerryType.WACAN, count: 3 },
      { name: "BERRY", type: BerryType.RINDO, count: 3 },
      { name: "BERRY", type: BerryType.YACHE, count: 3 },
      { name: "BERRY", type: BerryType.CHOPLE, count: 3 },
      { name: "BERRY", type: BerryType.KEBIA, count: 3 },
      { name: "BERRY", type: BerryType.SHUCA, count: 3 },
      { name: "BERRY", type: BerryType.COBA, count: 3 },
      { name: "BERRY", type: BerryType.PAYAPA, count: 3 },
      { name: "BERRY", type: BerryType.TANGA, count: 3 },
      { name: "BERRY", type: BerryType.CHARTI, count: 3 },
      { name: "BERRY", type: BerryType.KASIB, count: 3 },
      { name: "BERRY", type: BerryType.HABAN, count: 3 },
      { name: "BERRY", type: BerryType.COLBUR, count: 3 },
      { name: "BERRY", type: BerryType.BABIRI, count: 3 },
      { name: "BERRY", type: BerryType.CHILAN, count: 3 },
      { name: "BERRY", type: BerryType.ROSELI, count: 3 },
    ]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const berryPot = player.getHeldItems().find(item => item instanceof BerryPotModifier) as BerryPotModifier;

    expect(berryPot.tryGrowBerry(player)).toBe(false);
  });

  it("computer partner chooses a Symbiosis Pokemon that can hold Berry Pot", async () => {
    game.override.startingHeldItems([{ name: "BERRY_POT", count: 5 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);

    const berryPotType = getModifierType(modifierTypes.BERRY_POT);
    const choice = chooseComputerPartnerRewardOption(
      [new ModifierTypeOption(berryPotType, 0)],
      game.scene.getPlayerParty(),
    );

    expect(choice?.itemId).toBe("BERRY_POT");
    expect(choice?.targetPokemonIndex).toBe(1);
  });

  it("computer partner ignores Berry Pot when no Pokemon has Symbiosis", async () => {
    game.override.ability(AbilityId.UNNERVE);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const berryPotType = getModifierType(modifierTypes.BERRY_POT);
    const choice = chooseComputerPartnerRewardOption(
      [new ModifierTypeOption(berryPotType, 0)],
      game.scene.getPlayerParty(),
    );

    expect(choice).toBeUndefined();
  });
});
