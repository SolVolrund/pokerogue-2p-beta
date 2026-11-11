import { beforeAll, expect, it, vi } from "vitest";
import Phaser from "phaser";
import { GameManager } from "#test/framework/game-manager";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { PrivateRegistrationPhase } from "#phases/private-registration-phase";
import { CaptureCustomizerEncounter } from "#mystery-encounters/capture-customizer-encounter";
import { PalletExhibitionEncounter } from "#mystery-encounters/pallet-exhibition-encounter";
import { SpookyInvitationEncounter } from "#mystery-encounters/spooky-invitation-encounter";
import { FarawayIslandTreasureEncounter } from "#mystery-encounters/faraway-island-treasure-encounter";
import { LifeIsWonderfulEncounter } from "#mystery-encounters/life-is-wonderful-encounter";
import * as dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as phases from "#mystery-encounters/encounter-phase-utils";
import { PokeballType } from "#enums/pokeball";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { MiningEncounter } from "#mystery-encounters/mining-encounter";
import { LegendaryConflictEncounter } from "#mystery-encounters/legendary-conflict-encounter";

let phaser: Phaser.Game;
beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });

it.each([
  [SpookyInvitationEncounter, [1], 1],
  [PalletExhibitionEncounter, [0, 0, 0], 0],
  [LifeIsWonderfulEncounter, [0, 0, 1], 1],
  [FarawayIslandTreasureEncounter, [1, 1, 0], 0],
  [CaptureCustomizerEncounter, [2, 0, 3], 2],
  [MiningEncounter, [1, 0], 1],
  [LegendaryConflictEncounter, [1, 2, 2], 1],
] as const)("resolves the private prompt for encounter $0.encounterType", async (template, picks, expected) => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  const seats = picks.length === 2 ? 2 : 3;
  scene.configureTwoPlayerMode(true, 6, false, seats);
  scene.twoPlayerLocalInputSeat = 0;
  scene.privateTurnSelection = true;
  scene.newBattle();
  const encounter = scene.currentBattle.mysteryEncounter = new MysteryEncounter(template);
  if (template === CaptureCustomizerEncounter) encounter.onInit!();
  if (template === LegendaryConflictEncounter) encounter.misc = { choices: [] };
  scene.uiInputs ??= {} as typeof scene.uiInputs;
  Object.defineProperties(scene.uiInputs, {
    privateContestSeats: { configurable: true, value: seats },
    privateEventVotesEnabled: { configurable: true, value: true },
    privateEventVotesV2Enabled: { configurable: true, value: true },
  });
  scene.uiInputs.beginPrivateDraft = vi.fn();
  scene.uiInputs.submitPrivateContest = vi.fn(async (_key, value, review) => {
    expect(value).toBe(picks[0]);
    expect(review([...picks])).toBe(true);
    expect(review([-1, 0, 0])).toBe(false);
    return [...picks];
  });
  const tie = vi.spyOn(scene, "resolvePlayerTieBreak").mockReturnValue(2);
  const pushed = vi.spyOn(scene.phaseManager, "pushPhase").mockImplementation(() => {});
  const unshifted = vi.spyOn(scene.phaseManager, "unshiftPhase").mockImplementation(() => {});
  vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => {});
  vi.spyOn(scene.ui, "setMode").mockResolvedValue();
  vi.spyOn(scene.ui, "showText").mockImplementation(() => {});
  const menu = new MysteryEncounterPhase();
  const current = vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(menu);
  const proceed = vi.spyOn(menu, "continueEncounter").mockImplementation(() => {});
  menu.start();
  const phase = pushed.mock.lastCall![0] as PrivateRegistrationPhase;
  expect(phase.phaseName).toBe("PrivateRegistrationPhase");
  current.mockReturnValue(phase);
  phase.start();
  const history = scene.mysteryEncounterSaveData.encounteredEvents.length;
  if (picks.length === 1) {
    await vi.mocked(scene.uiInputs.beginPrivateDraft).mock.lastCall![2]!();
    expect(scene.uiInputs.submitPrivateContest).not.toHaveBeenCalled();
  } else {
    expect(phase.handleOptionSelect(encounter.options[picks[0]], picks[0])).toBe(true);
  }
  await vi.waitFor(() => expect(unshifted.mock.lastCall?.[0]).toBe(menu));
  current.mockReturnValue(menu);
  menu.start();
  await vi.waitFor(() => expect(proceed).toHaveBeenCalledOnce());
  expect(encounter.selectedOption).toBe(encounter.options[expected]);
  expect(scene.mysteryEncounterSaveData.encounteredEvents.length).toBe(history);
  expect(scene.mysteryEncounterSaveData.encounteredEvents.at(-1)?.selectedOption).toBe(expected);
  expect(tie).toHaveBeenCalledTimes(template.twoPlayerSharedDecision === true ? 1 : 0);
  if (template === MiningEncounter) {
    vi.spyOn(dialogue, "showEncounterText").mockResolvedValue();
    const queued = vi.spyOn(scene.phaseManager, "pushNew");
    await encounter.selectedOption!.onOptionPhase();
    expect(queued.mock.calls.filter(([name]) => name === "MiningPhase")).toEqual([["MiningPhase", 1, true]]);
  }
  if (template === LegendaryConflictEncounter) {
    vi.spyOn(dialogue, "showEncounterText").mockResolvedValue();
    const leave = vi.spyOn(phases, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    await encounter.selectedOption!.onOptionPhase();
    expect(encounter.misc.declined).toBe(true);
    expect(leave).toHaveBeenCalledOnce();
    expect(tie).not.toHaveBeenCalled();
  }
  if (template === CaptureCustomizerEncounter) {
    vi.spyOn(dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(dialogue, "showEncounterDialogue").mockResolvedValue();
    vi.spyOn(phases, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    const players = scene.getActivePlayerIndexes();
    const counts = () => players.map(p => scene.getPlayerPokeballCounts(p)[PokeballType.POKEBALL]);
    const before = counts();
    await encounter.selectedOption!.onOptionPhase();
    await encounter.selectedOption!.onOptionPhase();
    expect(counts()).toEqual([before[0] + 10, before[1] + 10, before[2]]);
    expect(players.map(p => scene.getPlayerState(p).ballDesign)).toEqual([encounter.misc.offers[2], encounter.misc.offers[0], undefined]);
  }
});

it.each([2, 3] as const)("records the audited openings in seat order for %i players", async count => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  scene.configureTwoPlayerMode(true, 6, false, count);
  scene.newBattle();
  const seats = scene.getActivePlayerIndexes();
  for (const type of [
    MysteryEncounterType.POKE_POACHERS, MysteryEncounterType.LEGENDARY_CONFLICT, MysteryEncounterType.MINING,
    MysteryEncounterType.SHINY_BADGE, MysteryEncounterType.A_TRAINERS_TEST, MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
    MysteryEncounterType.BERRIES_ABOUND, MysteryEncounterType.TRASH_TO_TREASURE, MysteryEncounterType.CLOWNING_AROUND,
    MysteryEncounterType.THE_STRONG_STUFF, MysteryEncounterType.THE_WINSTRATE_CHALLENGE, MysteryEncounterType.GTS_MALFUNCTION,
    MysteryEncounterType.WEIRD_DREAM, MysteryEncounterType.CHEFS_ON_VACATION, MysteryEncounterType.DEJA_VU,
  ]) {
    const encounter = scene.currentBattle.mysteryEncounter = new MysteryEncounter(allMysteryEncounters[type]!);
    encounter.misc = { choices: [], teamTransformationsByPlayer: {}, loadAssetsByPlayer: {} };
    expect(encounter.options.every(option => !option.hasRequirements())).toBe(true);
    const picks = seats.map((_, i) => (i + 1) % encounter.options.length);
    encounter.privateOpeningBallot!.accept(picks, seats);
    expect(encounter.misc.skipSelectedDialogueOnce).toBe(true);
    if (type === MysteryEncounterType.MINING) {
      expect(encounter.misc.participationPlayerIndexes).toEqual([1]);
      encounter.privateOpeningBallot!.accept(seats.map(() => 1), seats);
      expect(encounter.misc.participationPlayerIndexes).toEqual([]);
    } else {
      expect(encounter.misc.choices).toEqual(seats.map((playerIndex, i) => ({ playerIndex, optionIndex: picks[i] + 1 })));
    }
  }
});
