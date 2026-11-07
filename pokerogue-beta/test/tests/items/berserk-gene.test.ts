import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { Pokemon } from "#field/pokemon";
import { modifierPool } from "#modifiers/modifier-pools";
import * as settings from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import { isModifierAllowedByItemSettings } from "#utils/item-settings-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Berserk Gene", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("gates the Master-tier roll by the reward owner's unlock and respects Fresh Start and New Boss Items", async () => {
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.newBattle();
    for (const owner of [0, 1] as const) {
      game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 50));
    }
    const entry = modifierPool[ModifierTier.MASTER].find(item => item.modifierType.id === "BERSERK_GENE");
    const weight = entry?.weight;
    if (typeof weight !== "function") throw new Error("Expected unlock-gated Berserk Gene reward");
    expect(weight(game.scene.getPlayerParty(0), 0)).toBe(0);
    game.scene.getPlayerGameData(1).unlocks[Unlockables.BERSERK_GENE] = true;
    expect(weight(game.scene.getPlayerParty(1), 0)).toBe(1);
    expect(weight(game.scene.getPlayerParty(0), 0)).toBe(0);
    vi.spyOn(game.scene.gameMode, "isFreshStartChallenge").mockReturnValue(true);
    expect(weight(game.scene.getPlayerParty(1), 0)).toBe(0);
    const enabled = vi.spyOn(settings, "isSettingEnabled").mockReturnValue(false);
    expect(isModifierAllowedByItemSettings("BERSERK_GENE")).toBe(false);
    expect(enabled).toHaveBeenCalledWith(settings.SettingKeys.Item_Set_Boss_Items);
    game.scene.configureTwoPlayerMode(false);
  });

  it("lets the player choose Fight, then the AI chooses two moves and the extra one acts last", async () => {
    game.override.battleStyle("single").startingLevel(50).enemyLevel(50)
      .ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.TACKLE]).enemySpecies(SpeciesId.SHUCKLE).enemyMoveset(MoveId.SPLASH)
      .startingHeldItems([{ name: "BERSERK_GENE" }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const player = game.field.getPlayerPokemon();
    const ai = vi.spyOn(player, "getNextMove");
    const playerMoves = vi.spyOn(player, "pushMoveHistory");
    const enemyMoves = vi.spyOn(game.field.getEnemyPokemon(), "pushMoveHistory");
    expect(game.scene.ui.getMode()).toBe(UiMode.COMMAND);
    const commands = game.scene.ui.getHandler();
    commands.setCursor(Command.FIGHT);
    commands.processInput(Button.ACTION);
    await game.toNextTurn();
    expect(ai).toHaveBeenCalledTimes(2);
    expect(playerMoves.mock.calls.map(([move]) => move.move)).toEqual([MoveId.TACKLE, MoveId.TACKLE]);
    expect(enemyMoves.mock.invocationCallOrder[0]).toBeGreaterThan(playerMoves.mock.invocationCallOrder[0]);
    expect(enemyMoves.mock.invocationCallOrder[0]).toBeLessThan(playerMoves.mock.invocationCallOrder[1]);
  });
});
