import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { UiMode } from "#enums/ui-mode";
import { ModifierTier } from "#enums/modifier-tier";
import { ModifierTypeOption } from "#modifiers/modifier-type";
import { getMysteryEncounterPlayerTitle } from "#mystery-encounters/encounter-player-utils";
import { ModifierRewardPhase } from "#phases/modifier-reward-phase";
import { GameCornerRewardPhase } from "#phases/game-corner-reward-phase";
import { MoneyRewardPhase } from "#phases/money-reward-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import type { GameStatsUiHandler } from "#ui/game-stats-ui-handler";
import { NumberHolder } from "#utils/common";
import { getPlayerMessageOptions } from "#utils/player-messages";
import { getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Player names in shared messages", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let profiles: GameData[];
  let cpus: PlayerIndex[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.hideUsername = false;
    game.scene.activePlayerIndex = 0;
    profiles = ["Daniel", "Alex", "Robin"].map(playerDisplayName =>
      Object.assign(Object.create(GameData.prototype), { playerDisplayName }),
    );
    cpus = [];
    vi.spyOn(game.scene, "getPlayerGameData").mockImplementation(
      (player = game.scene.activePlayerIndex) => profiles[player],
    );
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(player => cpus.includes(player));
    vi.spyOn(game.scene, "getComputerPartnerKey").mockReturnValue("cheryl");
  });

  afterEach(() => {
    game.scene.hideUsername = false;
    game.scene.configureTwoPlayerMode(false);
  });

  it.each([0, 1, 2] as const)("uses the action owner's name for seat %s, independently of the active player", owner => {
    game.scene.activePlayerIndex = owner === 0 ? 1 : 0;
    const name = profiles[owner].playerDisplayName;
    expect(game.scene.getPlayerDisplayName(owner)).toBe(name);
    expect(getMysteryEncounterPlayerTitle(owner)).toBe(name);
    expect(new SelectModifierPhase()["getPlayerDisplayName"](owner)).toBe(name);
    const text = i18next.t("battle:pokemonCaught", {
      ...getPlayerMessageOptions(owner),
      pokemonName: "Eevee",
    });
    expect(text).toBe(`${name} caught\nEevee!`);
  });

  it("uses CPU trainer names instead of the CPU seat's human profile", () => {
    cpus = [2];
    expect(game.scene.getPlayerDisplayName(2)).toBe("Cheryl");
    expect(getMysteryEncounterPlayerTitle(2)).toBe("Cheryl");
  });

  it("uses a seat label while a remote profile is unavailable", () => {
    profiles.length = 1;
    expect(game.scene.getPlayerDisplayName(2)).toBe("Player 3");
  });

  it("normalizes names before inserting them into dialogue", () => {
    profiles[1].playerDisplayName = "@s{sound}\n[red]Alex";
    expect(game.scene.getPlayerDisplayName(1)).toBe("ssoundredAlex");
  });

  it("falls back to seat labels for blank or hidden human names without hiding CPU trainers", () => {
    profiles[1].playerDisplayName = "   ";
    expect(game.scene.getPlayerDisplayName(1)).toBe("Player 2");
    game.scene.hideUsername = true;
    cpus = [2];
    expect(game.scene.getPlayerDisplayName(0)).toBe("Player 1");
    expect(game.scene.getPlayerDisplayName(2)).toBe("Cheryl");
  });

  it("retains solo capture and reward wording", () => {
    game.scene.twoPlayerMode = false;
    expect(
      i18next.t("battle:pokemonCaught", {
        ...getPlayerMessageOptions(0),
        pokemonName: "Eevee",
      }),
    ).toBe("Gotcha!\nEevee was caught!");
    expect(
      i18next.t("battle:rewardGain", {
        ...getPlayerMessageOptions(0),
        modifierName: "Potion",
      }),
    ).toBe("You received\nPotion!");
  });

  it("names the owner of a private choice while withholding their selection", () => {
    const handler = game.scene.ui.handlers[UiMode.MYSTERY_ENCOUNTER] as MysteryEncounterUiHandler;
    handler["overrideSettings"] = { privateOwnerPlayerIndex: 2 };
    expect(handler["getPrivateWaitingText"]()).toBe("Robin is choosing...");
    expect(handler["getPrivateOptionTooltipText"]()).toBe("Waiting for Robin to choose.");
  });

  it("attributes a reward to its recipient even when another player is active", async () => {
    vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    const show = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const reward = new ModifierRewardPhase(modifierTypes.POKEBALL, 2);
    const completed = reward.doReward();
    expect(show.mock.calls[0][0]).toMatch(/^Robin received\n/);
    show.mock.calls[0][2]!();
    await completed;
  });

  it("names the Game Corner buyer without changing their purchase accounting", () => {
    const phase = new GameCornerRewardPhase(32, 2);
    phase["slots"] = [
      {
        kind: "item",
        cost: 25,
        purchased: false,
        tier: ModifierTier.ROGUE,
        option: new ModifierTypeOption(getModifierType(modifierTypes.HEALING_CHARM), 0),
      },
    ];
    vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    phase["refreshRewardCounter"] = vi.fn();
    const show = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    expect(phase["selectPrize"](0)).toBe(true);
    expect(phase["nuggies"]).toBe(7);
    expect(show.mock.calls[0][0]).toBe("Robin received Healing Charm. Nuggies remaining: 7.");
  });

  it("uses the chosen name in the statistics heading", () => {
    game.scene.activePlayerIndex = 2;
    const handler = game.scene.ui.handlers[UiMode.GAME_STATS] as GameStatsUiHandler;
    expect(handler["getUsername"]()).toBe(i18next.t("gameStatsUiHandler:stats", { username: "Robin" }));
  });

  it("shows each player's actual payout and completes only after the last message", () => {
    const phase = new MoneyRewardPhase(1);
    vi.spyOn(game.scene, "getPlayerFieldOwners").mockReturnValue([0, 1, 2]);
    phase["getMoneyAmount"] = (owner = 0) => new NumberHolder([100, 200, 300][owner]);
    const credit = vi.spyOn(game.scene, "addMoneyForPlayer").mockImplementation(() => {});
    vi.spyOn(game.scene, "setActivePlayerIndex").mockImplementation(() => {});
    vi.spyOn(game.scene, "updateMoneyText").mockImplementation(() => {});
    vi.spyOn(game.scene, "waitForSharedInput").mockImplementation(() => {});
    const show = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    for (let owner = 0; owner < 3; owner++) {
      expect(credit).toHaveBeenCalledWith((owner + 1) * 100, owner, false);
      expect(show.mock.calls[owner][0]).toBe(
        `${profiles[owner].playerDisplayName} got\n₽${(owner + 1) * 100} for winning!`,
      );
      expect(end).not.toHaveBeenCalled();
      show.mock.calls[owner][2]!();
    }
    expect(end).toHaveBeenCalledOnce();
  });
});
