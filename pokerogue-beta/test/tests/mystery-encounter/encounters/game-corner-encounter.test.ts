import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon, type PlayerPokemon } from "#field/pokemon";
import { HealingBoosterModifier, type PersistentModifier } from "#modifiers/modifier";
import { ModifierTypeOption } from "#modifiers/modifier-type";
import { GameCornerEncounter } from "#mystery-encounters/game-corner-encounter";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterSaveData } from "#mystery-encounters/mystery-encounter-save-data";
import {
  getMysteryEncounterBattleGroup,
  getMysteryEncounterCompatibilityAllowlist,
  getMysteryEncounterVsVariantForType,
} from "#mystery-encounters/mystery-encounter-compatibility";
import * as PlayerMenus from "#mystery-encounters/encounter-player-utils";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterUtils from "#mystery-encounters/encounter-phase-utils";
import { GameCornerRewardPhase } from "#phases/game-corner-reward-phase";
import { VoltorbFlipPhase } from "#phases/voltorb-flip-phase";
import { GameManager } from "#test/framework/game-manager";
import type { GameCornerPokemonRewardSlot } from "#ui/game-corner-reward-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { GAME_CORNER_CPU_PAYOUT_WEIGHTS, rollGameCornerCpuNuggies, withGameCornerSeed } from "#utils/game-corner";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Game Corner multiplayer visits and CPU rewards", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let parties: PlayerPokemon[][];
  let cpus: PlayerIndex[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 33;
    game.scene.currentBattle.mysteryEncounter = new MysteryEncounter(GameCornerEncounter);
    parties = [[], [], []];
    cpus = [];
    game.scene.twoPlayerMode = true;
    vi.spyOn(game.scene, "getActivePlayerIndexes").mockReturnValue([0, 1, 2]);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(player => cpus.includes(player));
    vi.spyOn(game.scene, "getPlayerParty").mockImplementation(
      (player = game.scene.activePlayerIndex) => parties[player],
    );
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(6);
    vi.spyOn(game.scene, "setActivePlayerIndex").mockImplementation(player => {
      game.scene.activePlayerIndex = player;
    });
    vi.spyOn(game.scene, "waitForPlayerInput").mockImplementation(player => {
      game.scene.activePlayerIndex = player;
      game.scene.inputOwner = player;
    });
    vi.spyOn(game.scene, "waitForPlayerSideProgressionInput").mockImplementation((player = 0) => {
      game.scene.activePlayerIndex = player;
      game.scene.inputOwner = player;
    });
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
  });

  function addPokemon(player: PlayerIndex, species = SpeciesId.MAGIKARP): PlayerPokemon {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 30);
    pokemon.generateAndPopulateMoveset();
    parties[player].push(pokemon);
    return pokemon;
  }

  function jackpot(phase: GameCornerRewardPhase): GameCornerPokemonRewardSlot {
    return phase["generateShadowPokemonSlot"]({
      minStarterCost: 9,
      maxStarterCost: 10,
      cost: 32,
      tier: ModifierTier.MASTER,
      layout: { col: 5, row: 2 },
      jackpot: true,
    });
  }

  async function startFullPartyPurchase(player: PlayerIndex, multiplayer = true) {
    game.scene.twoPlayerMode = multiplayer;
    for (const owner of [0, 1, 2] as const) {
      for (let i = 0; i < 6; i++) {
        addPokemon(owner);
      }
    }
    vi.spyOn(game.scene, "getPlayerFieldOwners").mockReturnValue([0, 1, 2]);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
    const ui = game.scene.ui;
    // Headless sprites do not have atlas frames; keep the real counter/input handlers.
    vi.spyOn(ui.handlers[UiMode.GAME_CORNER_REWARD] as any, "createPrizeIcon").mockImplementation(() =>
      game.scene.add.sprite(0, 0, "pokemon_icons_0"),
    );
    // The default text mock immediately invokes callbacks, masking input-mode bugs.
    vi.spyOn(ui, "showText").mockImplementation((text, _delay, callback, _callbackDelay, prompt) => {
      ui.getMessageHandler().showText(text, 0, callback, 0, prompt);
    });
    const phase = new GameCornerRewardPhase(32, player, false);
    const slot = jackpot(phase);
    phase["slots"] = [slot];
    await ui.setMode(UiMode.GAME_CORNER_REWARD, phase["getUiConfig"]());
    game.scene.activePlayerIndex = player === 0 ? 1 : 0;
    const purchase = phase["applyPokemonPrize"](slot, 0);
    await vi.waitFor(() => {
      expect(ui.getMode()).toBe(UiMode.MESSAGE);
      expect(ui.getMessageHandler().getTwoPlayerMessageInputContextKey()).toBeDefined();
    });
    return { phase, slot, purchase };
  }

  it.each([
    { player: 0, multiplayer: false },
    { player: 0, multiplayer: true },
    { player: 1, multiplayer: true },
    { player: 2, multiplayer: true },
  ] as const)("opens the full-party release menu for prize owner $player (multiplayer: $multiplayer) and charges only after replacement", async ({
    player,
    multiplayer,
  }) => {
    const { phase, slot, purchase } = await startFullPartyPurchase(player, multiplayer);
    const ui = game.scene.ui;
    const originalParties = parties.map(party => [...party]);
    expect(game.scene.activePlayerIndex).toBe(player);
    if (multiplayer) {
      expect(game.scene.inputOwner).toBe(player);
    }
    expect(phase["nuggies"]).toBe(32);
    expect(slot.purchased).toBe(false);

    expect(ui.processInput(Button.ACTION)).toBe(true);
    expect(ui.getMode()).toBe(UiMode.CONFIRM);
    expect(ui.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.PARTY));
    const partyUi = ui.getHandler<PartyUiHandler>();
    expect(partyUi["getParty"]()).toEqual(parties[player]);
    const showText = partyUi.showText.bind(partyUi);
    vi.spyOn(partyUi, "showText").mockImplementation((text, _delay, callback, _callbackDelay, prompt) => {
      showText(text, 0, callback, 0, prompt);
    });
    partyUi.doRelease(2);
    expect(ui.processInput(Button.ACTION)).toBe(true);
    await purchase;

    expect(ui.getMode()).toBe(UiMode.GAME_CORNER_REWARD);
    expect(phase["nuggies"]).toBe(0);
    expect(slot.purchased).toBe(true);
    expect(parties[player]).toHaveLength(6);
    expect(parties[player]).not.toContain(originalParties[player][2]);
    expect(parties[player][2].isBioInstabilityEevee()).toBe(true);
    expect(parties[player][2].isShadowPokemon()).toBe(true);
    expect(parties[player][2].friendship).toBe(0);
    for (const owner of [0, 1, 2] as const) {
      if (owner !== player) {
        expect(parties[owner]).toEqual(originalParties[owner]);
      }
    }
  });

  it.each([
    false,
    true,
  ])("returns to the counter without charging when declining a full-party prize (cancel menu first: %s)", async cancelMenu => {
    const { phase, slot, purchase } = await startFullPartyPurchase(2);
    const originalParty = [...parties[2]];
    const ui = game.scene.ui;
    expect(ui.processInput(Button.ACTION)).toBe(true);
    expect(ui.getMode()).toBe(UiMode.CONFIRM);
    if (cancelMenu) {
      expect(ui.processInput(Button.ACTION)).toBe(true);
      await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.PARTY));
      expect(ui.processInput(Button.CANCEL)).toBe(true);
      await vi.waitFor(() => {
        expect(ui.getMode()).toBe(UiMode.MESSAGE);
        expect(ui.getMessageHandler().getTwoPlayerMessageInputContextKey()).toBeDefined();
      });
      expect(ui.processInput(Button.ACTION)).toBe(true);
      expect(ui.getMode()).toBe(UiMode.CONFIRM);
    }
    expect(ui.processInput(Button.CANCEL)).toBe(true);
    await vi.waitFor(() => {
      expect(ui.getMode()).toBe(UiMode.MESSAGE);
      expect(ui.getMessageHandler().getTwoPlayerMessageInputContextKey()).toBeDefined();
    });
    expect(ui.processInput(Button.ACTION)).toBe(true);
    await purchase;
    expect(ui.getMode()).toBe(UiMode.GAME_CORNER_REWARD);
    expect(phase["nuggies"]).toBe(32);
    expect(slot.purchased).toBe(false);
    expect(parties[2]).toEqual(originalParty);
    expect(game.scene.inputOwner).toBe(2);
  });

  it("allows independent Game Corner visits in co-op, EP, and Vs encounter pools", () => {
    for (const multiplayerPlayerCount of [1, 2, 3] as const) {
      for (const twoPlayerPartySize of [3, 6] as const) {
        for (const twoPlayerVsMode of [false, true]) {
          expect(
            getMysteryEncounterCompatibilityAllowlist({
              twoPlayerMode: true,
              twoPlayerVsMode,
              multiplayerPlayerCount,
              twoPlayerPartySize,
            }),
          ).toContain(MysteryEncounterType.GAME_CORNER);
        }
      }
    }
    expect(getMysteryEncounterBattleGroup(MysteryEncounterType.GAME_CORNER)).toBe("non-battle");
    expect(getMysteryEncounterVsVariantForType(MysteryEncounterType.GAME_CORNER)).toBe("owner-scoped-non-battle");
  });

  it("reserves exactly one of 100 jackpot rolls and keeps the bell curve between 10 and 31", () => {
    const results = Array.from({ length: 100 }, (_, first) => {
      let calls = 0;
      return rollGameCornerCpuNuggies(max => (calls++ === 0 ? first : max - 1));
    });
    expect(results.filter(value => value === 32)).toHaveLength(1);
    expect(results.filter(value => value === 31)).toHaveLength(99);
    expect(rollGameCornerCpuNuggies(vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0))).toBe(10);
    const total = GAME_CORNER_CPU_PAYOUT_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    const mean =
      0.32
      + (0.99 * GAME_CORNER_CPU_PAYOUT_WEIGHTS.reduce((sum, entry) => sum + entry.nuggies * entry.weight, 0)) / total;
    expect(mean).toBeCloseTo(21.085, 2);
    expect(GAME_CORNER_CPU_PAYOUT_WEIGHTS.toSorted((a, b) => b.weight - a.weight)[0].nuggies).toBe(21);
  });

  it("isolates each player's seeded results from intervening random calls", () => {
    const roll = () => Array.from({ length: 12 }, () => Phaser.Math.RND.integerInRange(0, 100000));
    const before = Phaser.Math.RND.state();
    const first = withGameCornerSeed(1, "prizes", roll);
    expect(Phaser.Math.RND.state()).toBe(before);
    roll();
    expect(withGameCornerSeed(1, "prizes", roll)).toEqual(first);
    expect(withGameCornerSeed(2, "prizes", roll)).not.toEqual(first);
    expect(withGameCornerSeed(1, "board", roll)).not.toEqual(first);
  });

  it("collects independent human choices, skips CPU menus, and queues CPU visits even if P1 leaves", async () => {
    cpus = [1];
    const menu = vi.spyOn(PlayerMenus, "showMysteryEncounterPlayerMenu").mockResolvedValue(undefined);
    const encounter = game.scene.currentBattle.mysteryEncounter!;
    expect(await encounter.options[3].onPreOptionPhase!()).toBe(false);
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ playerIndex: 2 }));
    const options = menu.mock.calls[0][0].overrideOptions!;
    expect(await options[0].onPreOptionPhase!()).toBe(true);
    const queued = vi.spyOn(game.scene.phaseManager, "pushNew").mockImplementation(() => {});
    await options[0].onOptionPhase();
    expect(queued.mock.calls).toEqual([
      ["VoltorbFlipPhase", 1, false],
      ["VoltorbFlipPhase", 2, true],
    ]);
  });

  it("leaves once when every human skips and there are no CPU participants", async () => {
    const encounter = game.scene.currentBattle.mysteryEncounter!;
    encounter.misc = { gameCornerChoices: { 0: 3, 1: 3, 2: 3 } };
    const leave = vi.spyOn(EncounterUtils, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    await encounter.options[3].onOptionPhase();
    expect(leave).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("checks investigative moves against the selecting player's party", () => {
    addPokemon(1).setMove(0, MoveId.DETECT);
    const option = game.scene.currentBattle.mysteryEncounter!.options[2];
    expect(option.meetsPrimaryRequirementAndPrimaryPokemonSelected()).toBe(false);
    addPokemon(0).setMove(0, MoveId.DETECT);
    expect(option.meetsPrimaryRequirementAndPrimaryPokemonSelected()).toBe(true);
  });

  it("shares one player's HQ discovery but waits until the final player's post-event phase", async () => {
    const encounter = game.scene.currentBattle.mysteryEncounter!;
    const menu = vi.spyOn(PlayerMenus, "showMysteryEncounterPlayerMenu").mockResolvedValue(undefined);
    const immediate = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    const later = vi.spyOn(game.scene.phaseManager, "pushNew").mockImplementation(() => {});
    addPokemon(0).setMove(0, MoveId.DETECT);
    expect(await encounter.options[2].onPreOptionPhase!()).toBe(false);
    const secondOptions = menu.mock.calls[0][0].overrideOptions!;
    expect(await secondOptions[0].onPreOptionPhase!()).toBe(false);
    const thirdOptions = menu.mock.calls[1][0].overrideOptions!;
    expect(await thirdOptions[0].onPreOptionPhase!()).toBe(true);
    await thirdOptions[0].onOptionPhase();
    expect(later.mock.calls).toEqual([
      ["VoltorbFlipPhase", 1, false],
      ["VoltorbFlipPhase", 2, true],
    ]);
    expect(immediate).not.toHaveBeenCalled();
    expect(game.scene.mysteryEncounterSaveData.rocketHqVisited).toBe(false);
    await thirdOptions[0].onPostOptionPhase!();
    expect(immediate).toHaveBeenCalledExactlyOnceWith("SwitchBiomePhase", BiomeId.ROCKET_HQ);
    expect(game.scene.mysteryEncounterSaveData.rocketHqVisited).toBe(true);
    await thirdOptions[0].onPostOptionPhase!();
    expect(immediate).toHaveBeenCalledOnce();
  });

  it("enters HQ after a solo stake-out, even when nobody plays a minigame", async () => {
    vi.spyOn(game.scene, "getActivePlayerIndexes").mockReturnValue([0]);
    const encounter = game.scene.currentBattle.mysteryEncounter!;
    const leave = vi.spyOn(EncounterUtils, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    const immediate = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    addPokemon(0).setMove(0, MoveId.DETECT);
    expect(await encounter.options[2].onPreOptionPhase!()).toBe(true);
    await encounter.options[2].onOptionPhase();
    expect(leave).toHaveBeenCalledExactlyOnceWith(true);
    expect(immediate).not.toHaveBeenCalled();
    await encounter.options[2].onPostOptionPhase!();
    expect(immediate).toHaveBeenCalledExactlyOnceWith("SwitchBiomePhase", BiomeId.ROCKET_HQ);
  });

  it("leaves the biome unchanged if nobody discovers HQ", async () => {
    const immediate = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    await game.scene.currentBattle.mysteryEncounter!.options[0].onPostOptionPhase!();
    expect(immediate).not.toHaveBeenCalled();
    expect(game.scene.mysteryEncounterSaveData.rocketHqVisited).toBe(false);
  });

  it("disables only Stake-Out on later visits and preserves the limit through save/load", async () => {
    game.scene.mysteryEncounterSaveData.rocketHqVisited = true;
    game.scene.mysteryEncounterSaveData = new MysteryEncounterSaveData(
      JSON.parse(JSON.stringify(game.scene.mysteryEncounterSaveData)),
    );
    const encounter = new MysteryEncounter(GameCornerEncounter);
    game.scene.currentBattle.mysteryEncounter = encounter;
    addPokemon(0).setMove(0, MoveId.DETECT);
    expect(encounter.options[2].meetsRequirements()).toBe(false);
    expect(encounter.options[0].meetsRequirements()).toBe(true);
    expect(encounter.options[3].meetsRequirements()).toBe(true);
    const menu = vi.spyOn(PlayerMenus, "showMysteryEncounterPlayerMenu").mockResolvedValue(undefined);
    const immediate = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    expect(await encounter.options[2].onPreOptionPhase!()).toBe(false);
    expect(menu).not.toHaveBeenCalled();
    encounter.misc = { rocketHqDiscovered: true };
    await encounter.options[2].onPostOptionPhase!();
    expect(immediate).not.toHaveBeenCalled();

    // A new run (and an older save without this field) starts with the route available.
    game.scene.mysteryEncounterSaveData = new MysteryEncounterSaveData();
    expect(encounter.options[2].meetsRequirements()).toBe(true);
    const legacy = JSON.parse(JSON.stringify(game.scene.mysteryEncounterSaveData));
    delete legacy.rocketHqVisited;
    expect(new MysteryEncounterSaveData(legacy).rocketHqVisited).toBe(false);
  });

  it("applies the run-wide visit limit to P2 and P3's menus as well", async () => {
    game.scene.mysteryEncounterSaveData.rocketHqVisited = true;
    for (const player of [0, 1, 2] as const) {
      addPokemon(player).setMove(0, MoveId.DETECT);
    }
    const menu = vi.spyOn(PlayerMenus, "showMysteryEncounterPlayerMenu").mockResolvedValue(undefined);
    await game.scene.currentBattle.mysteryEncounter!.options[0].onPreOptionPhase!();
    const secondOptions = menu.mock.calls[0][0].overrideOptions!;
    game.scene.setActivePlayerIndex(1);
    expect(secondOptions[2].meetsPrimaryRequirementAndPrimaryPokemonSelected()).toBe(true);
    expect(secondOptions[2].meetsRequirements()).toBe(false);
    await secondOptions[0].onPreOptionPhase!();
    const thirdOptions = menu.mock.calls[1][0].overrideOptions!;
    game.scene.setActivePlayerIndex(2);
    expect(thirdOptions[2].meetsPrimaryRequirementAndPrimaryPokemonSelected()).toBe(true);
    expect(thirdOptions[2].meetsRequirements()).toBe(false);
  });

  it("queues a human's counter before the next visit, and a loss does not end everybody's event", async () => {
    const phase = new VoltorbFlipPhase(1, false);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    const immediate = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    const later = vi.spyOn(game.scene.phaseManager, "pushNew").mockImplementation(() => {});
    phase["revealedNuggies"] = 24;
    await phase["finish"]("cashOut");
    expect(immediate).toHaveBeenCalledWith("GameCornerRewardPhase", 24, 1, false);
    expect(later).not.toHaveBeenCalled();
    const losing = new VoltorbFlipPhase(2, false);
    vi.spyOn(losing, "end").mockImplementation(() => {});
    await losing["finish"]("lost");
    expect(later).not.toHaveBeenCalled();
    const last = new VoltorbFlipPhase(2, true);
    vi.spyOn(last, "end").mockImplementation(() => {});
    await last["finish"]("lost");
    expect(later).toHaveBeenCalledExactlyOnceWith("PostMysteryEncounterPhase");
  });

  it("restores exclusive board input after dialogue and skips the board for CPU seats", () => {
    const phase = new VoltorbFlipPhase(2, true);
    game.scene.inputOwner = "both";
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    phase["enableInput"]();
    expect(game.scene.inputOwner).toBe(2);
    cpus = [2];
    vi.spyOn(phase, "end").mockImplementation(() => {});
    const enqueue = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => {});
    phase.start();
    expect(enqueue).toHaveBeenCalledWith("GameCornerRewardPhase", expect.any(Number), 2, true);
    expect(phase["board"]).toEqual([]);
  });

  it("prioritizes the jackpot without replacing an ace or a borrowed human Pokemon", () => {
    cpus = [1];
    for (let i = 0; i < 6; i++) {
      addPokemon(1);
    }
    parties[1][0].computerPartnerAce = true;
    parties[1][1].gtsMalfunctionOriginalPlayerIndex = 0;
    const phase = new GameCornerRewardPhase(32, 1, false);
    phase["slots"] = [jackpot(phase)];
    const choice = phase["getCpuPokemonChoice"]();
    expect(choice?.slot.jackpot).toBe(true);
    expect(choice?.replacement.replacedPokemonIndex).toBeGreaterThan(1);
    phase["nuggies"] = 31;
    expect(phase["getCpuPokemonChoice"]()).toBeUndefined();
  });

  it.each([
    0, 1, 2,
  ] as const)("charges player index %s for a real persistent prize and prevents buying it twice", player => {
    const inventories: PersistentModifier[][] = [[], [], []];
    vi.spyOn(game.scene, "getPlayerModifiers").mockImplementation(
      (owner = game.scene.activePlayerIndex) => inventories[owner],
    );
    vi.spyOn(game.scene, "updateModifiers").mockImplementation(() => {});
    vi.spyOn(game.scene, "validateAchvsForPlayer").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const error = vi.spyOn(game.scene.ui, "playError").mockImplementation(() => {});
    const phase = new GameCornerRewardPhase(32, player, false);
    const type = getModifierType(modifierTypes.HEALING_CHARM);
    phase["slots"] = [
      {
        kind: "item",
        cost: 25,
        purchased: false,
        tier: ModifierTier.ROGUE,
        option: new ModifierTypeOption(type, 0),
      },
    ];
    // Keep the existing stack so this also exercises successful stack increments.
    inventories[player].push(type.newModifier() as PersistentModifier);
    vi.spyOn(phase as any, "refreshRewardCounter").mockImplementation(() => {});
    game.scene.activePlayerIndex = player === 0 ? 1 : 0;

    expect(phase["selectPrize"](0)).toBe(true);
    expect(phase["nuggies"]).toBe(7);
    expect(phase["slots"][0].purchased).toBe(true);
    expect(inventories[player]).toHaveLength(1);
    expect(inventories[player][0]).toBeInstanceOf(HealingBoosterModifier);
    expect(inventories[player][0].stackCount).toBe(2);
    expect(inventories.filter((_, owner) => owner !== player).every(items => items.length === 0)).toBe(true);
    expect(error).not.toHaveBeenCalled();

    expect(phase["selectPrize"](0)).toBe(false);
    expect(phase["nuggies"]).toBe(7);
    expect(inventories[player][0].stackCount).toBe(2);
    expect(error).toHaveBeenCalledOnce();
  });

  it("buys only affordable useful items and re-evaluates after each purchase", async () => {
    cpus = [1];
    addPokemon(1);
    const phase = new GameCornerRewardPhase(25, 1, false);
    phase["slots"] = [30, 10, 15].map(cost => ({
      kind: "item",
      cost,
      purchased: false,
      tier: ModifierTier.COMMON,
      option: new ModifierTypeOption(getModifierType(modifierTypes.POKEBALL), 0),
    }));
    vi.spyOn(phase, "end").mockImplementation(() => {});
    const continuation = vi.spyOn(game.scene.phaseManager, "unshiftPhase").mockImplementation(() => {});
    const apply = vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    await phase["takeCpuShoppingTurn"]();
    expect(phase["nuggies"]).toBe(15);
    expect(phase["slots"].map(slot => slot.purchased)).toEqual([false, true, false]);
    await phase["takeCpuShoppingTurn"]();
    expect(phase["nuggies"]).toBe(0);
    expect(phase["slots"].map(slot => slot.purchased)).toEqual([false, true, true]);
    expect(apply.mock.calls.every(call => call[6] === 1)).toBe(true);
    expect(continuation).toHaveBeenCalledTimes(2);
    const cashOut = vi.fn(() => true);
    phase["cashOut"] = cashOut;
    await phase["takeCpuShoppingTurn"]();
    expect(cashOut).toHaveBeenCalledOnce();
  });

  it("does not charge for a failed purchase and does not keep retrying it", async () => {
    cpus = [1];
    addPokemon(1);
    const phase = new GameCornerRewardPhase(10, 1, false);
    phase["slots"] = [
      {
        kind: "item",
        cost: 10,
        purchased: false,
        tier: ModifierTier.COMMON,
        option: new ModifierTypeOption(getModifierType(modifierTypes.POKEBALL), 0),
      },
    ];
    vi.spyOn(phase, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "unshiftPhase").mockImplementation(() => {});
    vi.spyOn(game.scene, "addModifier").mockReturnValue(false);
    await phase["takeCpuShoppingTurn"]();
    expect(phase["nuggies"]).toBe(10);
    const cashOut = vi.fn(() => true);
    phase["cashOut"] = cashOut;
    await phase["takeCpuShoppingTurn"]();
    expect(cashOut).toHaveBeenCalledOnce();
  });

  it("adds the jackpot only to its CPU owner and leaves protected Pokemon intact", async () => {
    cpus = [1];
    const human = addPokemon(0, SpeciesId.PIKACHU);
    for (let i = 0; i < 6; i++) {
      addPokemon(1);
    }
    const ace = parties[1][0];
    ace.computerPartnerAce = true;
    const borrowed = parties[1][1];
    borrowed.gtsMalfunctionOriginalPlayerIndex = 0;
    const phase = new GameCornerRewardPhase(32, 1, false);
    phase["setActiveRewardPlayer"]();
    phase["slots"] = [jackpot(phase)];
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    vi.spyOn(phase, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "unshiftPhase").mockImplementation(() => {});
    const dex = vi.spyOn(game.scene.gameData, "setPokemonCaught");
    await phase["takeCpuShoppingTurn"]();
    expect(parties[0]).toEqual([human]);
    expect(parties[1]).toHaveLength(6);
    expect(parties[1]).toContain(ace);
    expect(parties[1]).toContain(borrowed);
    const reward = parties[1].find(pokemon => pokemon.isBioInstabilityEevee());
    expect(reward?.isShadowPokemon()).toBe(true);
    expect(reward?.friendship).toBe(0);
    expect(phase["nuggies"]).toBe(0);
    expect(dex).not.toHaveBeenCalled();
  });

  it("credits leftover money to the CPU owner before handing summary input to a human", async () => {
    cpus = [1];
    const money = [1000, 50, 500];
    vi.spyOn(game.scene, "getPlayerMoney").mockImplementation((player = game.scene.activePlayerIndex) => money[player]);
    vi.spyOn(game.scene, "setPlayerMoney").mockImplementation((value, player = game.scene.activePlayerIndex) => {
      money[player] = value;
    });
    vi.spyOn(game.scene, "getWaveMoneyAmount").mockReturnValue(123);
    vi.spyOn(game.scene, "animateMoneyChanged").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const phase = new GameCornerRewardPhase(9, 1, false);
    const finish = vi.fn();
    phase["finish"] = finish;
    phase["cashOut"]();
    await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(money).toEqual([1000, 173, 500]);
    expect(game.scene.inputOwner).toBe(0);
    expect(phase["nuggies"]).toBe(0);
  });
});
