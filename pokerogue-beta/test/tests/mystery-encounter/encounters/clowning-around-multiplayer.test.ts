import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { Pokemon } from "#field/pokemon";
import { isVsLaneTargetLegal } from "#moves/move-utils";
import { ClowningAroundEncounter } from "#mystery-encounters/clowning-around-encounter";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterUtils from "#mystery-encounters/encounter-phase-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBattlePhase, MysteryEncounterRewardsPhase } from "#phases/mystery-encounter-phases";
import { SummonPhase } from "#phases/summon-phase";
import { SwitchPhase } from "#phases/switch-phase";
import { SwitchSummonPhase } from "#phases/switch-summon-phase";
import { CommandPhase } from "#phases/command-phase";
import { MoneyRewardPhase } from "#phases/money-reward-phase";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { FaintPhase } from "#phases/faint-phase";
import { GameManager } from "#test/framework/game-manager";
import { PartyOption } from "#ui/party-ui-handler";
import { getComputerPartnerPartyMemberMatchupScores } from "#utils/computer-partner-ai";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Clowning Around multiplayer fields and trials", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(Dialogue, "showEncounterDialogue").mockResolvedValue();
    vi.spyOn(EncounterUtils, "transitionMysteryEncounterIntroVisuals").mockResolvedValue(true);
    vi.spyOn(EncounterUtils, "loadCustomMovesForEncounter").mockResolvedValue();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function setup(count: 1 | 2 | 3, fighters: PlayerIndex[], vs = false) {
    const scene = game.scene;
    scene.configureTwoPlayerMode(count > 1, 6, false, count, undefined, vs);
    scene.currentBattle = new Battle(scene.gameMode, {
      waveIndex: 105,
      battleType: BattleType.MYSTERY_ENCOUNTER,
      double: true,
      wildBattlerCount: 3,
    });
    scene.currentBattle.incrementTurn();
    for (const playerIndex of scene.getActivePlayerIndexes()) {
      const party = scene.getPlayerParty(playerIndex);
      party.splice(0);
      for (let i = 0; i < 4; i++) {
        const pokemon = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.ARCANINE), 80);
        party.push(pokemon);
        vi.spyOn(pokemon, "isOnField").mockReturnValue(false);
      }
      scene.getPlayerTrainerBackSprite(playerIndex).setVisible(false);
    }
    const encounter = new MysteryEncounter(ClowningAroundEncounter);
    scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit!();
    encounter.misc = {
      ...encounter.misc,
      choices: scene.getActivePlayerIndexes().map(playerIndex => ({
        playerIndex,
        optionIndex: fighters.includes(playerIndex) ? 1 : 3,
      })),
      battlePlayers: [],
    };
    return encounter;
  }

  function verifyField(owners: PlayerIndex[], expectedEnemies: number) {
    const scene = game.scene;
    expect(scene.getPlayerFieldOwners()).toEqual(owners);
    expect(scene.getEnemyParty()).toHaveLength(expectedEnemies);
    expect(scene.getEnemyField()).toHaveLength(expectedEnemies);
    const playerField = scene.getPlayerField();
    expect(new Set(playerField).size).toBe(owners.length);
    for (let i = 0; i < owners.length; i++) {
      expect(new SummonPhase(i).getPokemon()).toBe(playerField[i]);
      expect(playerField[i].getFieldIndex()).toBe(i);
      expect(scene.getPlayerIndexForPokemon(playerField[i])).toBe(owners[i]);
    }
    const effects = scene.currentBattle.mysteryEncounter!.startOfBattleEffects;
    expect(effects[0].move.moveId).toBe(MoveId.ROLE_PLAY);
    expect(effects).toHaveLength(1 + owners.length);
    for (const effect of effects) {
      expect(scene.getField()[effect.sourceBattlerIndex!]).toBeTruthy();
      for (const target of effect.targets) expect(scene.getField()[target]).toBeTruthy();
    }
    const push = vi.spyOn(scene.phaseManager, "pushNew");
    const phase = new MysteryEncounterBattlePhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase["endBattleSetup"]();
    expect(push.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1]))
      .toEqual(owners.map((_, index) => index));
    expect(() => EncounterUtils.handleMysteryEncounterBattleStartEffects()).not.toThrow();
    push.mockRestore();
    scene.phaseManager.clearPhaseQueue();
  }

  const scenarios = ([2, 3] as const).flatMap(count =>
    Array.from({ length: (1 << count) - 1 }, (_, mask) => ({
      count,
      fighters: Array.from({ length: count }, (_, player) => player as PlayerIndex)
        .filter(player => ((mask + 1) & (1 << player)) !== 0),
    })),
  );

  it.each(scenarios)("co-op $count players, fighters $fighters", async ({ count, fighters }) => {
    const encounter = setup(count, fighters);
    await encounter.options[0].onOptionPhase!();
    const owners = fighters.length === 1 ? [fighters[0], fighters[0]] : fighters;
    verifyField(owners, Math.max(2, fighters.length));
    game.scene.clearMysteryEncounterBattlePlayerFieldOwners();
    expect(game.scene.getPlayerFieldOwners()).toEqual(game.scene.getActivePlayerIndexes());
    expect(game.scene.currentBattle.mysteryEncounterSoloPlayerIndex).toBeUndefined();
  });

  it("keeps solo doubles even when the entering wild battle had three slots", async () => {
    const encounter = setup(1, [0]);
    await encounter.options[0].onOptionPhase!();
    expect(game.scene.currentBattle.getBattlerCount()).toBe(2);
    expect(game.scene.getPlayerField()).toHaveLength(2);
    expect(game.scene.getEnemyField()).toHaveLength(2);
  });

  it("does not summon or target a missing second usable party member", async () => {
    const encounter = setup(3, [2]);
    const party = game.scene.getPlayerParty(2);
    party.forEach((pokemon, index) => { if (index !== 2) pokemon.hp = 0; });
    const survivor = party[2];
    await encounter.options[0].onOptionPhase!();
    expect(party[0]).toBe(survivor);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const phase = new MysteryEncounterBattlePhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase["endBattleSetup"]();
    expect(push.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1])).toEqual([0]);
    expect(encounter.startOfBattleEffects).toHaveLength(2);
    expect(game.scene.getEnemyField()).toHaveLength(2);
  });

  it("replaces the second slot from its owner's bench, not the first active slot", async () => {
    const encounter = setup(3, [2]);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    const party = scene.getPlayerParty(2);
    party[1].hp = 0;
    const first = party[0];
    const replacement = party[2];
    const ui = vi.spyOn(scene.ui, "setMode").mockResolvedValue();
    const phase = new SwitchPhase(SwitchType.SWITCH, 1, true, false);
    phase.start();
    expect(scene.activePlayerIndex).toBe(2);
    const callback = ui.mock.calls[0][3] as (index: number, option: PartyOption) => void;
    const unshift = vi.spyOn(scene.phaseManager, "unshiftNew");
    callback(1, PartyOption.SEND_OUT);
    expect(unshift).not.toHaveBeenCalledWith("SwitchSummonPhase", expect.anything(), expect.anything(), 1, expect.anything());
    callback(2, PartyOption.SEND_OUT);
    expect(unshift).toHaveBeenCalledWith("SwitchSummonPhase", SwitchType.SWITCH, 1, 2, false);
    const summon = new SwitchSummonPhase(SwitchType.SWITCH, 1, 2, false);
    vi.spyOn(summon, "summon").mockImplementation(() => {});
    summon.switchAndSummon();
    expect(party[0]).toBe(first);
    expect(party[1]).toBe(replacement);
    expect(getComputerPartnerPartyMemberMatchupScores(2).map(([index]) => index)).not.toContain(1);
  });

  it.each([2, 3] as const)("runs %i Vs trials in sequence with normal doubles targeting", async count => {
    const fighters = Array.from({ length: count }, (_, player) => player as PlayerIndex);
    const encounter = setup(count, fighters, true);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    const rewards = vi.spyOn(EncounterUtils, "setEncounterRewards");
    for (const playerIndex of fighters) {
      verifyField([playerIndex, playerIndex], 2);
      expect(scene.twoPlayerVsMode).toBe(true);
      expect(scene.isVsLaneBattle()).toBe(false);
      expect(scene.getBattleParticipantPlayerIndexes()).toEqual([playerIndex]);
      const [mime, blacephalon] = scene.getEnemyField();
      expect(isVsLaneTargetLegal(mime, blacephalon)).toBe(true);
      expect(isVsLaneTargetLegal(scene.getPlayerField()[0], blacephalon)).toBe(true);
      scene.getEnemyParty().forEach(pokemon => { pokemon.hp = 0; });
      await encounter.doContinueEncounter!();
    }
    expect(encounter.doContinueEncounter).toBeUndefined();
    expect(encounter.misc.winningPlayers).toEqual(fighters);
    expect(rewards.mock.calls.map(call => call[3])).toEqual(fighters);
    expect(scene.phaseManager.hasPhaseOfType("MysteryEncounterRewardsPhase")).toBe(true);
    expect(scene.phaseManager.hasPhaseOfType("EggLapsePhase")).toBe(true);
    scene.clearMysteryEncounterBattlePlayerFieldOwners();
    expect(scene.isVsLaneBattle()).toBe(true);
  });

  it("continues after a lost trial without granting its reward or ending Vs early", async () => {
    const encounter = setup(3, [0, 2], true);
    await encounter.options[0].onOptionPhase!();
    game.scene.getPlayerParty(0).forEach(pokemon => { pokemon.hp = 0; });
    expect(game.scene.queueVsModeVictoryIfDecided()).toBe(false);
    await encounter.doContinueEncounter!();
    verifyField([2, 2], 2);
    expect(encounter.misc.winningPlayers).toEqual([]);
    expect(game.scene.getPlayerParty(0).every(pokemon => pokemon.hp === 0)).toBe(true);
  });

  it("queues a next battle through the real rewards-phase continuation", async () => {
    const encounter = setup(2, [0, 1], true);
    await encounter.options[0].onOptionPhase!();
    game.scene.getEnemyParty().forEach(pokemon => { pokemon.hp = 0; });
    const phase = new MysteryEncounterRewardsPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    await vi.waitFor(() => expect(end).toHaveBeenCalled());
    expect(game.scene.getPlayerFieldOwners()).toEqual([1, 1]);
    expect(game.scene.phaseManager.hasPhaseOfType("MysteryEncounterBattlePhase")).toBe(true);
  });

  it("does not let two commands reserve the same replacement Pokemon", async () => {
    const encounter = setup(3, [2]);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    scene.currentBattle.turnCommands[scene.getPlayerBattlerIndex(0)] = { command: Command.POKEMON, cursor: 2 };
    expect(scene.isPlayerSwitchReserved(2, 2, 1)).toBe(true);
    expect(scene.isPlayerSwitchReserved(2, 3, 1)).toBe(false);
    expect(scene.isPlayerSwitchReserved(1, 2, 1)).toBe(false);
    expect(new CommandPhase(1).handleCommand(Command.POKEMON, 2, false)).toBe(false);
  });

  it("both prompts belong to P3, and neither skips after only Mr. Mime faints in Vs", async () => {
    const encounter = setup(3, [2], true);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    scene.getEnemyParty()[0].hp = 0;
    vi.spyOn(scene.getEnemyParty()[1], "isActive").mockReturnValue(true);
    for (const fieldIndex of [0, 1]) {
      const phase = new CommandPhase(fieldIndex);
      phase["setActiveCommandPlayer"]();
      expect(scene.activePlayerIndex).toBe(2);
      expect(phase["shouldAutoSkipClearedVsModeLane"](scene.getPlayerPokemonForFieldSlot(fieldIndex)!)).toBe(false);
    }
  });

  it("a faint in the second slot queues its own replacement prompt", async () => {
    const encounter = setup(3, [2]);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    const party = scene.getPlayerParty(2);
    party[1].hp = 0;
    vi.spyOn(party[0], "isActive").mockReturnValue(true);
    vi.spyOn(party[1], "faintCry").mockImplementation(() => {});
    const push = vi.spyOn(scene.phaseManager, "pushNew");
    const phase = new FaintPhase(scene.getPlayerBattlerIndex(1), true);
    phase["doFaint"]();
    expect(push).toHaveBeenCalledWith("SwitchPhase", SwitchType.SWITCH, 1, true, false);
  });

  it("keeps lane restrictions in ordinary Vs battles", async () => {
    const encounter = setup(2, [0, 1], true);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    scene.clearMysteryEncounterBattlePlayerFieldOwners();
    expect(scene.isVsLaneBattle()).toBe(true);
    expect(isVsLaneTargetLegal(scene.getPlayerField()[0], scene.getEnemyField()[0])).toBe(true);
    expect(isVsLaneTargetLegal(scene.getPlayerField()[0], scene.getEnemyField()[1])).toBe(false);
  });

  it("isolates EXP, money, and battle-end item processing to the current trial owner", async () => {
    const encounter = setup(3, [1, 2], true);
    await encounter.options[0].onOptionPhase!();
    const scene = game.scene;
    const exp = vi.spyOn(scene, "applyPartyExp");
    scene.applyPartyExp(50, true);
    expect(exp.mock.calls.filter(call => call[4] !== undefined).map(call => call[4])).toEqual([1]);
    const money = vi.spyOn(scene, "addMoneyForPlayer");
    const moneyPhase = new MoneyRewardPhase(1);
    vi.spyOn(scene.ui, "showText").mockImplementation(() => {});
    moneyPhase.start();
    expect(money.mock.calls.map(call => call[1])).toEqual([1]);
    const recover = vi.spyOn(scene, "recoverBattleTransferredHeldItems");
    scene.getEnemyParty().forEach(pokemon => { pokemon.hp = 0; });
    const endPhase = new BattleEndPhase(true);
    vi.spyOn(endPhase, "end").mockImplementation(() => {});
    endPhase.start();
    expect(recover).toHaveBeenCalledWith([1]);
    await encounter.doContinueEncounter!();
    expect(encounter.misc.winningPlayers).toEqual([1]);
    expect(scene.getPlayerFieldOwners()).toEqual([2, 2]);
  });
});
