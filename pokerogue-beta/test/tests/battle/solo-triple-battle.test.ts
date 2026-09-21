import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { FieldPosition } from "#enums/field-position";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import type { PersistentModifier } from "#modifiers/modifier";
import { TitlePhase } from "#phases/title-phase";
import { SwitchPhase } from "#phases/switch-phase";
import { ToggleDoublePositionPhase } from "#phases/toggle-double-position-phase";
import { GameManager } from "#test/framework/game-manager";
import type { NewBattleConstructedProps } from "#types/new-battle-props";
import type { SessionSaveData } from "#types/save-data";
import type { CommandUiHandler } from "#ui/command-ui-handler";
import { PartyOption, PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import * as Common from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Solo wild encounter size", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    activeOverrides.BATTLE_STYLE_OVERRIDE = null;
    game.scene.modifiers = [];
  });

  function lures(count: number) {
    game.scene.modifiers = [modifierTypes.LURE, modifierTypes.SUPER_LURE, modifierTypes.MAX_LURE]
      .slice(0, count)
      .map(factory => factory().newModifier() as PersistentModifier);
  }

  function battle(size: 1 | 2 | 3, waveIndex = 2) {
    return new Battle(game.scene.gameMode, {
      waveIndex,
      battleType: BattleType.WILD,
      double: size > 1,
      wildBattlerCount: size,
    });
  }

  function addParty() {
    const party = game.scene.getPlayerParty();
    for (const id of [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE, SpeciesId.EEVEE]) {
      party.push(game.scene.addPlayerPokemon(getPokemonSpecies(id), 20));
    }
    return party;
  }

  it.each([
    [0, 32, 8],
    [1, 8, 2],
    [2, 2, 1],
    [3, 1, 1],
  ])("uses the requested roll denominators with %i lure tiers", (count, triple, double) => {
    lures(count);
    const rng = vi.spyOn(Common, "randSeedInt").mockReturnValue(1);
    expect(game.scene["rollSoloWildBattlerCount"](2)).toBe(1);
    expect(rng.mock.calls.map(call => call[0])).toEqual([triple, double]);
    rng.mockClear().mockReturnValue(0);
    expect(game.scene["rollSoloWildBattlerCount"](2)).toBe(3);
    expect(rng.mock.calls.map(call => call[0])).toEqual([triple]);
    rng.mockClear().mockReturnValueOnce(1).mockReturnValueOnce(0);
    expect(game.scene["rollSoloWildBattlerCount"](2)).toBe(2);
  });

  it.each([
    [0, 128, 32],
    [1, 32, 8],
    [2, 8, 2],
    [3, 2, 1],
  ])("retains rarer wild boss encounters with %i lure tiers", (count, triple, double) => {
    lures(count);
    const rng = vi.spyOn(Common, "randSeedInt").mockReturnValue(1);
    game.scene["rollSoloWildBattlerCount"](10);
    expect(rng.mock.calls.map(call => call[0])).toEqual([triple, double]);
  });

  it("guarantees normal triples with three lure tiers using the real seeded RNG", () => {
    lures(3);
    for (let i = 0; i < 100; i++) {
      expect(game.scene["rollSoloWildBattlerCount"](2)).toBe(3);
    }
  });

  it("records the successful triple roll before Battle generates its enemy levels", () => {
    lures(3);
    const props: NewBattleConstructedProps = { waveIndex: 2, battleType: BattleType.WILD };
    props.double = game.scene["checkIsDouble"](props);
    const created = new Battle(game.scene.gameMode, { ...props, double: props.double });
    expect(created.getBattlerCount()).toBe(3);
    expect(created.enemyLevels).toHaveLength(3);
  });

  it.each([200, 1000])("does not roll triples for a protected boss wave %i", waveIndex => {
    if (waveIndex === 1000) {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    }
    lures(3);
    const roll = vi.spyOn(game.scene, "rollSoloWildBattlerCount" as never);
    expect(game.scene["checkIsDouble"]({ waveIndex, battleType: BattleType.WILD })).toBe(false);
    expect(roll).not.toHaveBeenCalled();
  });

  it("preserves forced singles/doubles, mystery encounters, trainers, and multiplayer", () => {
    lures(3);
    const roll = vi.spyOn(game.scene, "rollSoloWildBattlerCount" as never);
    for (const style of ["single", "double"] as const) {
      activeOverrides.BATTLE_STYLE_OVERRIDE = style;
      expect(game.scene["checkIsDouble"]({ waveIndex: 2, battleType: BattleType.WILD })).toBe(style === "double");
    }
    activeOverrides.BATTLE_STYLE_OVERRIDE = null;
    expect(game.scene["checkIsDouble"]({ waveIndex: 2, battleType: BattleType.MYSTERY_ENCOUNTER })).toBe(false);
    expect(game.scene["checkIsDouble"]({ waveIndex: 2, battleType: BattleType.TRAINER, double: true })).toBe(true);
    for (const count of [2, 3] as const) {
      game.scene.configureTwoPlayerMode(true, 6, false, count);
      expect(game.scene["checkIsDouble"]({ waveIndex: 2, battleType: BattleType.WILD })).toBe(true);
      game.scene.currentBattle = battle(3);
      expect(game.scene.currentBattle.getBattlerCount()).toBe(count);
    }
    expect(roll).not.toHaveBeenCalled();
  });

  it("saves the rolled size and restores it without rerolling, including old doubles", () => {
    game.scene.currentBattle = battle(3);
    addParty();
    game.scene.currentBattle.enemyParty = [0, 1, 2].map(() =>
      game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE),
    );
    const saved = game.scene.gameData.getSessionSaveData();
    expect(saved.wildBattlerCount).toBe(3);
    const roll = vi.spyOn(game.scene, "rollSoloWildBattlerCount" as never);
    expect(game.scene.newBattle(saved).getBattlerCount()).toBe(3);
    const oldSave = { ...saved, enemyParty: saved.enemyParty.slice(0, 2) } as SessionSaveData;
    delete oldSave.wildBattlerCount;
    expect(game.scene.newBattle(oldSave).getBattlerCount()).toBe(2);
    expect(roll).not.toHaveBeenCalled();
  });

  it("exposes the third player slot, its owner and the solo reposition menu", () => {
    game.scene.currentBattle = battle(3);
    const party = addParty();
    expect(game.scene.getPlayerField()).toEqual(party.slice(0, 3));
    expect(game.scene.getField()[BattlerIndex.PLAYER_3]).toBe(party[2]);
    expect(game.scene.getPlayerIndexForFieldSlot(2)).toBe(0);
    expect(game.scene.getBattleFieldSlotCount()).toBe(3);
    const handler = game.scene.ui.handlers[UiMode.COMMAND] as CommandUiHandler;
    expect(handler["shouldShowTriplePokemonMenu"]()).toBe(true);
  });

  it("restores all three player summons when loading a solo triple", () => {
    game.scene.currentBattle = battle(3);
    addParty();
    const title = new TitlePhase();
    title["loaded"] = true;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    title.end();
    expect(queue.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1])).toEqual([0, 1, 2]);
    expect(queue.mock.calls.filter(call => call[0] === "CheckSwitchPhase").map(call => call[1])).toEqual([0, 1, 2]);
  });

  it("offers a bench replacement for a fainted third Pokemon without treating it as another player", () => {
    game.scene.currentBattle = battle(3);
    const party = addParty();
    party[2].hp = 0;
    party.forEach((p, i) => vi.spyOn(p, "isOnField").mockReturnValue(i < 2));
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    new SwitchPhase(SwitchType.SWITCH, 2, true, false).start();
    const args = mode.mock.calls.at(-1)!;
    expect(args.slice(0, 3)).toEqual([UiMode.PARTY, PartyUiMode.FAINT_SWITCH, 2]);
    (args[3] as (index: number, option: PartyOption) => void)(3, PartyOption.SEND_OUT);
    expect(queue).toHaveBeenCalledWith("SwitchSummonPhase", SwitchType.SWITCH, 2, 3, false);
  });

  it("fits all three active party panels above the item-management button and navigates through each", () => {
    game.scene.currentBattle = battle(3);
    addParty();
    const handler = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    handler.show([PartyUiMode.MODIFIER_TRANSFER, 2]);
    expect(handler["partySlots"].map(slot => slot.y)).toEqual([-216, -168, -120, -216]);
    expect(handler["partySlots"].slice(0, 3).every(slot => slot["slotBgKey"] === "party_slot_main_short")).toBe(true);
    handler.setCursor(0);
    for (const cursor of [1, 2, 7, 3, 6, 0]) {
      handler["processPartyDirectionalInput"](Button.DOWN);
      expect(handler.getCursor()).toBe(cursor);
    }
    handler.clear();
  });

  it("recalls the third slot when shrinking and recalculates positions without switching the remaining party", async () => {
    const previous = battle(3, 2);
    game.scene.currentBattle = previous;
    const party = addParty();
    for (const p of party.slice(0, 3)) {
      vi.spyOn(p, "isOnField").mockReturnValue(true);
      vi.spyOn(p, "isActive").mockReturnValue(true);
    }
    game.scene.currentBattle = battle(2, 3);
    vi.spyOn(game.scene, "trySpreadPokerus").mockImplementation(() => {});
    vi.spyOn(game.scene, "triggerPokemonFormChange").mockReturnValue(false);
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    game.scene["doPostBattleCleanup"](previous, game.scene.getMaxExpLevel());
    expect(queue).toHaveBeenCalledWith("ReturnPhase", 2);
    expect(queue).toHaveBeenCalledWith("ToggleDoublePositionPhase", true, 3);
    expect(queue.mock.calls.some(call => call[0] === "ReturnPhase" && call[1] !== 2)).toBe(false);
    party[0].fieldPosition = FieldPosition.LEFT;
    party[0].setPosition(34, 140);
    for (const p of party.slice(0, 2)) {
      vi.spyOn(p, "setFieldPosition").mockResolvedValue();
    }
    const phase = new ToggleDoublePositionPhase(true, 3);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(party[0].x).toBe(74);
    expect(party[1].setFieldPosition).toHaveBeenCalledWith(FieldPosition.RIGHT, 500);
    expect(phase.end).toHaveBeenCalledOnce();
  });
});

describe("Solo triple battle flow", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it.each([1, 2, 3])("plays a complete triple-battle turn with %i available Pokemon", async count => {
    const game = new GameManager(phaserGame);
    // The headless sprite mock has no animation frame for accessory rendering.
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .startingWave(2)
      .startingModifier([{ name: "LURE" }, { name: "SUPER_LURE" }, { name: "MAX_LURE" }])
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP);
    if (count === 1) {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    } else if (count === 2) {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    } else {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
    }
    expect(game.scene.getEnemyField()).toHaveLength(3);
    expect(game.scene.getPlayerField(true)).toHaveLength(count);
    const positions =
      count === 1
        ? [FieldPosition.CENTER]
        : [FieldPosition.LEFT, FieldPosition.RIGHT, FieldPosition.CENTER].slice(0, count);
    expect(game.scene.getPlayerField().map(p => p.fieldPosition)).toEqual(positions);
    for (let i = 0; i < count; i++) {
      game.move.select(MoveId.SPLASH);
    }
    await game.phaseInterceptor.to("TurnStartPhase", false);
    for (const index of [BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER_3].slice(0, count)) {
      expect(game.scene.currentBattle.turnCommands[index]?.move?.move).toBe(MoveId.SPLASH);
    }
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.scene.getPlayerField().every(p => p.moveset[0].ppUsed === 1)).toBe(true);
  });
});
