import { beforeAll, expect, it, vi } from "vitest";
import Phaser from "phaser";
import { BattleStyle } from "#enums/battle-style";
import { Button } from "#enums/buttons";
import { BattleType } from "#enums/battle-type";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { queueMultiplayerOpeningSwitches } from "#phases/check-switch-phase";
import type { PrivateRegistrationPhase } from "#phases/private-registration-phase";
import { GameManager } from "#test/framework/game-manager";
import { PartyOption, type PartyUiHandler } from "#ui/party-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

let phaser: Phaser.Game;
beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });

it.each(["switch", "decline", "cancel", "no-reserve", "reject", "legacy", "set"])("collects opening switches (%s)", async scenario => {
  const scene = new GameManager(phaser);
  await scene.runToTitle();
  const game = scene.scene;
  const size = scenario === "decline" ? 2 : 3;
  const local = size === 2 ? 1 : 2;
  game.configureTwoPlayerMode(true, 6, false, size);
  game.twoPlayerLocalInputSeat = local;
  game.newBattle();
  game.currentBattle.battleType = BattleType.WILD;
  game.currentBattle.double = true;
  game.privateTurnSelection = true;
  game.battleStyle = scenario === "set" ? BattleStyle.SET : BattleStyle.SWITCH;
  const seats = game.getActivePlayerIndexes();
  const reserves = seats.map(seat => {
    const lead = game.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 10);
    const reserve = game.addPlayerPokemon(getPokemonSpecies(SpeciesId.PSYDUCK), 10);
    game.getPlayerParty(seat).push(lead, reserve);
    game.field.add(lead);
    vi.spyOn(lead, "getFieldIndex").mockReturnValue(seat);
    if (scenario === "no-reserve" && seat === local) reserve.hp = 0;
    return reserve;
  });
  game.uiInputs ??= {} as typeof game.uiInputs;
  Object.defineProperties(game.uiInputs, {
    privateContestSeats: { configurable: true, value: size },
    privateOpeningSwitchEnabled: { configurable: true, value: scenario !== "legacy" },
  });
  const queued = vi.spyOn(game.phaseManager, "pushPhase").mockImplementation(() => {});
  const run = vi.spyOn(game.phaseManager, "unshiftNew").mockImplementation(() => {});
  vi.spyOn(game.phaseManager, "shiftPhase").mockImplementation(() => {});
  const mode = vi.spyOn(game.ui, "setMode").mockResolvedValue();
  const text = vi.spyOn(game.ui, "showText").mockImplementation(() => {});
  queueMultiplayerOpeningSwitches();
  if (scenario === "legacy" || scenario === "set") {
    expect(queued.mock.calls.map(([p]) => p.phaseName)).toEqual(seats.map(() => "CheckSwitchPhase"));
    return;
  }
  const [draft, ...checks] = queued.mock.calls.map(([p]) => p);
  expect(draft.phaseName).toBe("PrivateRegistrationPhase");
  const current = vi.spyOn(game.phaseManager, "getCurrentPhase").mockReturnValue(draft);
  const choices = seats.map(seat => seat === 0 || (seat === local && scenario === "switch") ? reserves[seat].id : -1);
  game.uiInputs.beginPrivateDraft = vi.fn();
  game.uiInputs.submitPrivateContest = vi.fn(async (_key, choice, legal) => {
    expect(choice).toBe(choices[local]);
    expect(legal(choices)).toBe(true);
    expect(legal(choices.map((_id, i) => i === local ? reserves[0].id : -1))).toBe(false);
    return scenario === "reject" ? null : choices;
  });
  const end = vi.spyOn(draft, "end").mockImplementation(() => {});
  (draft as PrivateRegistrationPhase).start();
  if (scenario !== "no-reserve") {
    expect(mode.mock.lastCall?.[0]).toBe(UiMode.CONFIRM);
    if (scenario === "switch" || scenario === "cancel") {
      mode.mock.lastCall![1]();
      expect(mode.mock.lastCall?.slice(0, 3)).toEqual([UiMode.PARTY, PartyUiMode.POST_BATTLE_SWITCH, local]);
      const party = game.ui.handlers[UiMode.PARTY] as PartyUiHandler;
      expect(party.show(mode.mock.lastCall!.slice(1))).toBe(true);
      expect(party["getParty"]()).toBe(game.getPlayerParty(local));
      if (scenario === "cancel") party.processInput(Button.CANCEL);
      else {
        party.setCursor(1);
        party.showOptions();
        expect(party["options"]).toEqual([PartyOption.SEND_OUT, PartyOption.CANCEL]);
        party.processInput(Button.ACTION);
      }
      party.clear(); // setMode is mocked, so complete the menu's normal teardown.
    } else mode.mock.lastCall![2]();
  } else expect(mode.mock.calls.some(([m]) => m === UiMode.CONFIRM)).toBe(false);
  await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
  expect(run).not.toHaveBeenCalled();
  text.mockClear();
  for (const check of checks) {
    current.mockReturnValue(check);
    check.start();
  }
  if (scenario === "reject") {
    expect(run).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(size);
  } else {
    expect(text).not.toHaveBeenCalled();
    expect(run.mock.calls).toEqual(seats.filter(seat => choices[seat] !== -1)
      .map(seat => ["SwitchSummonPhase", SwitchType.INITIAL_SWITCH, seat, 1, true]));
  }
});
