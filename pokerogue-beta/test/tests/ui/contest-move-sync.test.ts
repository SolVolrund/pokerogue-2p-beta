import type { Phase } from "#app/phase";
import type { TwoPlayerInputTransport } from "#app/two-player-input-transport";
import * as ContestAudio from "#data/contests/contest-audio";
import { applyContestMove } from "#data/contests/contest-rules";
import { ContestState, createContestParticipant } from "#data/contests/contest-state";
import { ContestType } from "#data/contests/contest-type";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { ContestCommandPhase } from "#phases/contests/contest-command-phase";
import { GameManager } from "#test/framework/game-manager";
import { ContestInputUiHandler } from "#ui/contest-input-ui-handler";
import * as ContestUi from "#ui/contest-ui";
import * as UiTheme from "#ui/ui-theme";
import { UiMode } from "#enums/ui-mode";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Contest move synchronization", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let now: number;
  let activePhase: Phase;
  let activeHandler: ContestInputUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    game.scene.uiInputs["twoPlayerInputTransport"] = undefined;
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockImplementation(() => activePhase);
    vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => undefined!);
    vi.spyOn(game.scene.ui, "getMode").mockReturnValue(UiMode.CONTEST_INPUT);
    vi.spyOn(game.scene.ui, "getHandler").mockImplementation(() => activeHandler);
    vi.spyOn(game.scene.ui, "playSelect").mockImplementation(() => {});
    vi.spyOn(ContestAudio, "playContestTurnNotification").mockImplementation(() => {});
    vi.spyOn(UiTheme, "updateWindowType").mockImplementation(() => {});
    vi.spyOn(ContestUi, "getContestUi").mockReturnValue({
      showPhase: vi.fn(),
      setCommandSelection: vi.fn(),
    } as unknown as ReturnType<typeof ContestUi.getContestUi>);
    vi.spyOn(ContestUi, "getContestPlayerMoves").mockReturnValue([MoveId.HARDEN, MoveId.TACKLE]);
    vi.spyOn(game.scene, "getPlayerIndexForPokemon").mockReturnValue(0);
  });

  function peer(round = 1, contestantId = "player_1") {
    const state = new ContestState({
      contestType: ContestType.BEAUTY,
      contestants: [
        createContestParticipant(contestantId, contestantId, {} as Pokemon),
        createContestParticipant("npc", "NPC"),
      ],
    });
    state.round = round;
    state.beginRound();
    const phase = new ContestCommandPhase(state, contestantId);
    const handler = new ContestInputUiHandler();
    const attach = () => {
      activePhase = phase;
      activeHandler = handler;
      game.scene.ui.handlers[UiMode.CONTEST_INPUT] = handler;
    };
    attach();
    phase.start();
    return { state, phase, handler, attach };
  }

  function score(state: ContestState) {
    const id = state.contestants[0].id;
    applyContestMove(state, id, state.getQueuedMove(id)!);
    state.recordAppeal("npc", { moveId: MoveId.TACKLE, appeal: 3, jam: 0 });
    state.finishRound();
    return { scores: state.contestants.map(c => c.roundScore), order: state.turnOrder };
  }

  it.each([Button.ACTION, Button.SUBMIT])("confirms the same move despite a lost direction input (button %i)", button => {
    const host = peer();
    now = 200;
    const guest = peer();
    host.attach();
    now = 800;
    expect(host.handler.processInput(Button.DOWN)).toBe(true);
    guest.attach();
    now = 830;
    expect(guest.handler.processInput(Button.DOWN)).toBe(false);
    expect(guest.handler.getMoveSelection()?.moveId).toBe(MoveId.HARDEN);

    host.attach();
    now = 1100;
    const checkpoint = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(checkpoint.contestMoveSelection?.moveId).toBe(MoveId.TACKLE);
    expect(host.handler.processInput(button)).toBe(true);
    guest.attach();
    now = 1130;
    expect(game.scene.uiInputs.processRemoteInput(0, button, true, checkpoint)).toBe(true);
    expect(guest.state.getQueuedMove("player_1")).toBe(MoveId.TACKLE);
    expect(score(guest.state)).toEqual(score(host.state));
  });

  it("replays accepted directions and confirmation without applying a second local delay", () => {
    const host = peer();
    now = 200;
    const guest = peer();
    host.attach();
    now = 800;
    const direction = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(host.handler.processInput(Button.DOWN)).toBe(true);
    const confirm = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(host.handler.processInput(Button.ACTION)).toBe(true);
    guest.attach();
    now = 830;
    expect(guest.handler.isInputReady()).toBe(false);
    expect(game.scene.uiInputs.processRemoteInput(0, Button.DOWN, true, direction)).toBe(true);
    expect(game.scene.uiInputs.processRemoteInput(0, Button.ACTION, true, confirm)).toBe(true);
    expect(guest.state.getQueuedMove("player_1")).toBe(MoveId.TACKLE);
  });

  it.each([false, true])("does not broadcast inputs rejected by the local delay (guest: %s)", guest => {
    const client = peer();
    const send = vi.fn(() => true);
    const requestInput = vi.fn(() => true);
    game.scene.uiInputs["twoPlayerInputTransport"] = {
      getInputReadinessBlockReason: () => undefined,
      shouldRequestHostAuthority: () => guest,
      send,
      requestInput,
      sendCheckpoint: () => true,
    } as unknown as TwoPlayerInputTransport;
    now = 700;
    expect(game.scene.uiInputs["processLocalButtonInput"](Button.DOWN, true)).toBe(false);
    expect(game.scene.uiInputs["processLocalButtonInput"](Button.ACTION, true)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(requestInput).not.toHaveBeenCalled();
    now = 800;
    expect(game.scene.uiInputs["processLocalButtonInput"](Button.DOWN, true)).toBe(true);
    expect(guest ? requestInput : send).toHaveBeenCalledOnce();
    expect(client.handler.getMoveSelection()?.moveId).toBe(guest ? MoveId.HARDEN : MoveId.TACKLE);
    expect(game.scene.uiInputs["processLocalButtonInput"](Button.ACTION, true)).toBe(true);
    expect(guest ? requestInput : send).toHaveBeenLastCalledWith(
      Button.ACTION,
      true,
      expect.objectContaining({
        contestMoveSelection: { round: 1, contestantId: "player_1", moveId: guest ? MoveId.HARDEN : MoveId.TACKLE },
      }),
      ...(guest ? [] : [0]),
    );
  });

  it.each([
    { round: 2, contestantId: "player_1", moveId: MoveId.TACKLE },
    { round: 1, contestantId: "player_2", moveId: MoveId.TACKLE },
    { round: 1, contestantId: "player_1", moveId: MoveId.HYPER_BEAM },
    undefined,
  ])("rejects stale, wrong-contestant, unavailable, and missing move payloads: %j", selection => {
    const client = peer();
    now = 800;
    const checkpoint = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    delete checkpoint.contestMoveSelection;
    if (selection) {
      checkpoint.contestMoveSelection = selection;
    }
    expect(game.scene.uiInputs.processRemoteInput(0, Button.ACTION, true, checkpoint)).toBe(false);
    expect(client.state.getQueuedMove("player_1")).toBeUndefined();
    expect(game.scene.phaseManager.shiftPhase).not.toHaveBeenCalled();
  });

  it("identifies the round and contestant independently from a client's cursor", () => {
    const client = peer();
    now = 800;
    const before = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    client.handler.processInput(Button.DOWN);
    const after = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(after.inputContext?.id).toBe(before.inputContext?.id);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.inputContext?.key.handlerPromptState).toEqual({ round: 1, contestantId: "player_1" });
    peer(2);
    expect(game.scene.getTwoPlayerDebugStateCheckpoint()?.inputContext?.id).not.toBe(before.inputContext?.id);
    peer(1, "player_3");
    expect(game.scene.getTwoPlayerDebugStateCheckpoint()?.inputContext?.id).not.toBe(before.inputContext?.id);
  });

  it("rejects the wrong player and cannot confirm twice", () => {
    const client = peer();
    now = 800;
    const checkpoint = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(game.scene.uiInputs.processRemoteInput(1, Button.ACTION, true, checkpoint)).toBe(false);
    expect(game.scene.uiInputs.processRemoteInput(0, Button.ACTION, true, checkpoint)).toBe(true);
    expect(game.scene.uiInputs.processRemoteInput(0, Button.ACTION, true, checkpoint)).toBe(false);
    expect(client.state.getQueuedMove("player_1")).toBe(MoveId.HARDEN);
    expect(game.scene.phaseManager.shiftPhase).toHaveBeenCalledOnce();
  });

  it.each([1, 2] as const)("accepts confirmations from player index %i when they own the turn", index => {
    vi.mocked(game.scene.getPlayerIndexForPokemon).mockReturnValue(index);
    const client = peer(1, `player_${index + 1}`);
    now = 800;
    const checkpoint = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(game.scene.uiInputs.processRemoteInput(index, Button.ACTION, true, checkpoint)).toBe(true);
    expect(client.state.getQueuedMove(`player_${index + 1}`)).toBe(MoveId.HARDEN);
  });

  it("does not accept local or remote move input through a UI overlay", () => {
    const client = peer();
    now = 800;
    vi.spyOn(game.scene.ui, "isOverlayActive").mockReturnValue(true);
    const checkpoint = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(game.scene.uiInputs["processLocalButtonInput"](Button.ACTION, true)).toBe(false);
    expect(game.scene.uiInputs.processRemoteInput(0, Button.ACTION, true, checkpoint)).toBe(false);
    expect(client.state.getQueuedMove("player_1")).toBeUndefined();
  });

  it("keeps local solo selection and non-command contest prompts working", () => {
    game.scene.configureTwoPlayerMode(false);
    const client = peer();
    now = 800;
    expect(client.handler.processInput(Button.DOWN)).toBe(true);
    expect(client.handler.processInput(Button.ACTION)).toBe(true);
    expect(client.state.getQueuedMove("player_1")).toBe(MoveId.TACKLE);
    const onConfirm = vi.fn(() => true);
    client.handler.show([{ onConfirm }]);
    expect(client.handler.getMoveSelection()).toBeUndefined();
    expect(client.handler.processInput(Button.ACTION)).toBe(true);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
