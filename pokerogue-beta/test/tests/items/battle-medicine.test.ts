import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import type { PokemonModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { CommandPhase } from "#phases/command-phase";
import { UseBagMedicinePhase } from "#phases/use-bag-medicine-phase";
import { GameManager } from "#test/framework/game-manager";
import type { BallUiHandler } from "#ui/ball-ui-handler";
import { PartyOption } from "#ui/party-ui-handler";
import { getAvailableBattleMedicineCount } from "#utils/battle-medicine";
import { storeRewardInBag } from "#utils/item-bag";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Battle medicine commands and UI", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.newBattle();
    for (const owner of [0, 1, 2] as const) {
      for (let i = 0; i < 3; i++) {
        const mon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50);
        mon.hp = 1;
        mon.moveset = [new PokemonMove(MoveId.TACKLE, 4), new PokemonMove(MoveId.GROWL)];
        game.scene.getPlayerParty(owner).push(mon);
      }
    }
  });
  afterEach(() => {
    game.scene.ui.handlers[UiMode.BALL].clear();
    game.scene.ui.handlers[UiMode.PARTY].clear();
    game.scene.ui.resetModeChain();
    game.scene.configureTwoPlayerMode(false);
  });
  function add(id: keyof typeof modifierTypes, owner: PlayerIndex = 0) {
    const type = modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonModifierType;
    expect(storeRewardInBag(owner, type)).toBe(true);
  }
  function command(slot = 0) {
    const phase = new CommandPhase(slot);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    return phase;
  }
  function execute(owner: PlayerIndex, slot: number) {
    const medicine = game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(slot)]!.medicine!;
    const phase = new UseBagMedicinePhase(owner, JSON.parse(JSON.stringify(medicine)));
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
  }

  it.each([0, 1, 2] as const)("queues and resolves only owner %s's medicine against their benched target", owner => {
    add("POTION", owner);
    const party = game.scene.getPlayerParty(owner);
    const target = party[2];
    const phase = command(owner);
    const battler = game.scene.getPlayerBattlerIndex(owner);
    game.scene.currentBattle.preTurnCommands[battler] = { command: Command.TERA };
    expect(phase.handleMedicineCommand("POTION", target.id)).toBe(true);
    expect(phase.end).toHaveBeenCalledOnce();
    expect(target.hp).toBe(1);
    expect(game.scene.getPlayerBagMedicines(owner)[0].quantity).toBe(1);
    expect(game.scene.currentBattle.preTurnCommands[battler]).toBeNull();
    expect(game.scene.currentBattle.turnCommands[battler]?.command).toBe(Command.MEDICINE);
    // A party reorder must not redirect the item to a different Pokemon.
    [party[1], party[2]] = [party[2], party[1]];
    execute(owner, owner);
    expect(target.hp).toBeGreaterThan(1);
    expect(party[2].hp).toBe(1);
    expect(game.scene.getPlayerBagMedicines(owner)).toEqual([]);
  });

  it("rejects another player's Pokemon, missing items and full HP without spending a turn", () => {
    add("POTION");
    const phase = command();
    expect(phase.handleMedicineCommand("POTION", game.scene.getPlayerParty(1)[0].id)).toBe(false);
    const target = game.scene.getPlayerParty(0)[0];
    expect(phase.handleMedicineCommand("REVIVE", target.id)).toBe(false);
    target.hp = target.getMaxHp();
    expect(phase.handleMedicineCommand("POTION", target.id)).toBe(false);
    expect(phase.end).not.toHaveBeenCalled();
    expect(game.scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
  });

  it("reserves the last copy in a solo multi battle and releases it when commands are rewound", () => {
    game.scene.configureTwoPlayerMode(false);
    add("POTION");
    const target = game.scene.getPlayerParty(0)[2];
    const first = command(0);
    const second = command(1);
    expect(first.handleMedicineCommand("POTION", target.id)).toBe(true);
    expect(getAvailableBattleMedicineCount(0, "POTION")).toBe(0);
    expect(second.handleMedicineCommand("POTION", target.id)).toBe(false);
    expect(first.handleMedicineCommand("POTION", target.id)).toBe(true);
    second.cancel();
    expect(getAvailableBattleMedicineCount(0, "POTION")).toBe(1);
    expect(second.handleMedicineCommand("POTION", target.id)).toBe(true);
  });

  it("allows two actions with two copies, but does not consume a redundant heal", () => {
    game.scene.configureTwoPlayerMode(false);
    add("POTION");
    add("POTION");
    const target = game.scene.getPlayerParty(0)[2];
    target.hp = target.getMaxHp() - 1;
    expect(command(0).handleMedicineCommand("POTION", target.id)).toBe(true);
    expect(command(1).handleMedicineCommand("POTION", target.id)).toBe(true);
    execute(0, 0);
    execute(0, 1);
    expect(target.isFullHp()).toBe(true);
    expect(game.scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
  });

  it("requires a depleted move for Ether and restores it only on execution", () => {
    add("ETHER");
    const target = game.scene.getPlayerParty(0)[1];
    const phase = command();
    expect(phase.handleMedicineCommand("ETHER", target.id)).toBe(false);
    expect(phase.handleMedicineCommand("ETHER", target.id, -1)).toBe(false);
    expect(phase.handleMedicineCommand("ETHER", target.id, 1)).toBe(false);
    expect(phase.handleMedicineCommand("ETHER", target.id, 0)).toBe(true);
    expect(target.moveset[0].ppUsed).toBe(4);
    execute(0, 0);
    expect(target.moveset[0].ppUsed).toBe(0);
    expect(game.scene.getPlayerBagMedicines(0)).toEqual([]);
  });

  it.each(["REVIVE", "FULL_HEAL", "ELIXIR"] as const)("resolves %s from stored inventory", id => {
    add(id);
    const target = game.scene.getPlayerParty(0)[2];
    if (id === "REVIVE") {
      target.hp = 0;
    }
    if (id === "FULL_HEAL") {
      target.status = new Status(StatusEffect.BURN);
    }
    expect(command().handleMedicineCommand(id, target.id)).toBe(true);
    execute(0, 0);
    expect(target.hp).toBeGreaterThan(0);
    expect(target.status).toBeFalsy();
    if (id === "ELIXIR") {
      expect(target.moveset[0].ppUsed).toBe(0);
    }
    expect(game.scene.getPlayerBagMedicines(0)).toEqual([]);
  });

  it("keeps the item if the target leaves the party before resolution", () => {
    add("POTION");
    const party = game.scene.getPlayerParty(0);
    expect(command().handleMedicineCommand("POTION", party[2].id)).toBe(true);
    party.pop();
    execute(0, 0);
    expect(game.scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
    expect(party.every(mon => mon.hp === 1)).toBe(true);
  });

  it("scrolls the acting owner's Medicine pocket and opens their party without applying the item", async () => {
    for (const id of ["POTION", "ETHER", "REVIVE", "FULL_HEAL", "ELIXIR"] as const) {
      add(id, 2);
    }
    const phase = command(2);
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    const balls = game.scene.ui.handlers[UiMode.BALL] as BallUiHandler;
    balls.show([]);
    balls.processInput(Button.RIGHT);
    expect(balls["medicineImages"]).toHaveLength(5);
    expect(balls["optionsText"].text).toContain("Potion");
    balls.setCursor(4);
    expect(balls["scrollOffset"]).toBe(1);
    expect(balls["scrollBar"].visible).toBe(true);
    balls.setCursor(0);
    const setMode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    balls.processInput(Button.ACTION);
    const args = setMode.mock.calls[0];
    expect(args.slice(0, 3)).toEqual([UiMode.PARTY, PartyUiMode.MODIFIER, 2]);
    const selected = args[3] as (slot: number, option: PartyOption) => void;
    const filter = args[4] as (pokemon: Pokemon) => string | null;
    expect(filter(game.scene.getPlayerParty(2)[2])).toBeNull();
    expect(filter(game.scene.getPlayerParty(0)[0])).toBeTruthy();
    selected(2, PartyOption.APPLY);
    expect(game.scene.getPlayerParty(2)[2].hp).toBe(1);
    expect(game.scene.getPlayerBagMedicines(2)[0].quantity).toBe(1);
    expect(game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(2)]?.medicine?.targetId).toBe(
      game.scene.getPlayerParty(2)[2].id,
    );
  });

  it("returns to Medicine on target cancel, with no action or inventory consumption", async () => {
    add("ETHER");
    const phase = command();
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    const balls = game.scene.ui.handlers[UiMode.BALL] as BallUiHandler;
    const setMode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const restore = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    balls.show([]);
    balls.processInput(Button.RIGHT);
    balls.processInput(Button.ACTION);
    expect(setMode.mock.calls[0][1]).toBe(PartyUiMode.MOVE_MODIFIER);
    expect(setMode.mock.calls[0][7]).toBe(true);
    (setMode.mock.calls[0][3] as (slot: number) => void)(6);
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(UiMode.BALL, true));
    expect(phase.end).not.toHaveBeenCalled();
    expect(game.scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
    expect(game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(0)]).toBeNull();
  });
});

describe("Battle medicine turn execution", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("heals before attacks, replaces just the user's action and leaves their ally's move intact", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
    const user = game.scene.getPlayerParty()[0];
    const ally = game.scene.getPlayerParty()[1];
    user.hp = 1;
    const type = modifierTypes.POTION().withIdFromFunc(modifierTypes.POTION) as PokemonModifierType;
    expect(storeRewardInBag(0, type)).toBe(true);
    const phase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    expect(phase.phaseName).toBe("CommandPhase");
    expect(phase.handleMedicineCommand("POTION", user.id)).toBe(true);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("UseBagMedicinePhase");
    expect(user.hp).toBeGreaterThan(1);
    expect(user.moveset[0].ppUsed).toBe(0);
    expect(ally.moveset[0].ppUsed).toBe(0);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(user.moveset[0].ppUsed).toBe(0);
    expect(ally.moveset[0].ppUsed).toBe(1);
    expect(game.scene.getPlayerBagMedicines(0)).toEqual([]);
  });
});
