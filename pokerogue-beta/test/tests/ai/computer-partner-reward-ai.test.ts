import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BerryModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import { COMPUTER_PARTNER_PROFILES } from "#utils/computer-partner-profile";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("AI - Computer partner reward choices", () => {
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
      .enemyLevel(1)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP);
  });

  function resistanceBerryOption(berryType: BerryType): ModifierTypeOption {
    return new ModifierTypeOption(new BerryModifierType(berryType), 0);
  }

  it("places a resistance Berry on the Pokemon with the greatest matching weakness", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.CHARIZARD);

    const choice = chooseComputerPartnerRewardOption(
      [resistanceBerryOption(BerryType.CHARTI)],
      game.scene.getPlayerParty(),
      { computerPartnerProfile: COMPUTER_PARTNER_PROFILES.alex },
    );

    expect(choice?.itemId).toBe("BERRY");
    expect(choice?.targetPokemonIndex).toBe(1);
  });

  it("prefers the ace when party members share the same matching weakness", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.CHARMELEON);

    const party = game.scene.getPlayerParty();
    party[1].computerPartnerAce = true;
    const choice = chooseComputerPartnerRewardOption(
      [resistanceBerryOption(BerryType.PASSHO)],
      party,
      { computerPartnerProfile: COMPUTER_PARTNER_PROFILES.alex },
    );

    expect(choice?.itemId).toBe("BERRY");
    expect(choice?.targetPokemonIndex).toBe(1);
  });

  it("places a resistance Berry on the ace when no party member is weak to that type", async () => {
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE, SpeciesId.WARTORTLE);

    const party = game.scene.getPlayerParty();
    party[1].computerPartnerAce = true;
    const choice = chooseComputerPartnerRewardOption(
      [resistanceBerryOption(BerryType.OCCA)],
      party,
      { computerPartnerProfile: COMPUTER_PARTNER_PROFILES.alex },
    );

    expect(choice?.itemId).toBe("BERRY");
    expect(choice?.targetPokemonIndex).toBe(1);
  });

  it("does not let a resistance Berry outrank a better same-tier reward", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.CHARIZARD);

    const choice = chooseComputerPartnerRewardOption(
      [
        resistanceBerryOption(BerryType.CHARTI),
        new ModifierTypeOption(getModifierType(modifierTypes.RARE_CANDY), 0),
      ],
      game.scene.getPlayerParty(),
      { computerPartnerProfile: COMPUTER_PARTNER_PROFILES.alex },
    );

    expect(choice?.itemId).toBe("RARE_CANDY");
  });
});
