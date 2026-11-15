import { beforeAll, expect, it, vi } from "vitest";
import Phaser from "phaser";
import { GameManager } from "#test/framework/game-manager";
import { ContestHallEncounter } from "#mystery-encounters/encounters/contest-hall-encounter";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import * as dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as encounterPhases from "#mystery-encounters/encounter-phase-utils";
import { PrivateRegistrationPhase } from "#phases/private-registration-phase";
import { PrivatePauseMenuPhase } from "#phases/private-fight-phase";
import { MysteryEncounterOptionSelectedPhase } from "#phases/mystery-encounter-phases";
import { UiMode } from "#enums/ui-mode";
import { PartyOption, type PartyUiHandler } from "#ui/party-ui-handler";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

let phaser: Phaser.Game;
beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });

it.each(["enter", "decline", "switch-mode", "no-entrant"])("registers three contest seats (%s)", async scenario => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  scene.configureTwoPlayerMode(true, 6, false, 3);
  scene.twoPlayerLocalInputSeat = 2;
  scene.privateTurnSelection = true;
  scene.newBattle();
  const encounter = scene.currentBattle.mysteryEncounter = new MysteryEncounter(ContestHallEncounter);
  const players = scene.getActivePlayerIndexes();
  const ids = players.map(seat => {
    const pokemon = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 10);
    scene.getPlayerParty(seat).push(pokemon);
    if (scenario === "no-entrant" && seat === 2) {
      vi.spyOn(pokemon, "isAllowedInBattle").mockReturnValue(false);
      return -1;
    }
    return pokemon.id;
  });
  const pushed = vi.spyOn(scene.phaseManager, "pushPhase").mockImplementation(() => {});
  const unshifted = vi.spyOn(scene.phaseManager, "unshiftPhase").mockImplementation(() => {});
  const current = vi.spyOn(scene.phaseManager, "getCurrentPhase");
  vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => {});
  vi.spyOn(scene.ui, "fadeOut").mockResolvedValue();
  vi.spyOn(encounterPhases, "transitionMysteryEncounterIntroVisuals").mockResolvedValue(true);
  const leave = vi.spyOn(encounterPhases, "leaveEncounterWithoutBattle").mockImplementation(() => {});
  vi.spyOn(dialogue, "showEncounterText").mockResolvedValue();
  const mode = vi.spyOn(scene.ui, "setMode").mockResolvedValue();
  vi.spyOn(scene.ui, "showText").mockImplementation(() => {});
  scene.uiInputs ??= {} as typeof scene.uiInputs;
  scene.uiInputs.beginPrivateDraft = vi.fn();
  scene.uiInputs.broadcastTwoPlayerSettingsSnapshot = vi.fn();
  let picks = scenario === "decline" ? [1, 1, 0] : [1, 0, 0];
  scene.uiInputs.submitPrivateContest = vi.fn(async (_key, pick, validate) => {
    expect(pick).toBe(picks[2]);
    expect(validate(picks)).toBe(true);
    expect(validate([picks[0], picks[1], -99])).toBe(false);
    if (picks === ids) expect(validate([picks[1], picks[0], picks[2]])).toBe(false);
    return picks;
  });
  const startStep = () => {
    const phase = pushed.mock.lastCall![0] as PrivateRegistrationPhase;
    expect(phase.phaseName).toBe("PrivateRegistrationPhase");
    current.mockReturnValue(phase);
    phase.start();
    return phase;
  };
  const resolveStep = async () => {
    await vi.waitFor(() => expect(unshifted.mock.lastCall?.[0].phaseName).toBe("MysteryEncounterOptionSelectedPhase"));
    const shared = unshifted.mock.lastCall![0] as MysteryEncounterOptionSelectedPhase;
    current.mockReturnValue(shared);
    unshifted.mockClear();
    await shared.onOptionSelect();
  };
  encounter.queuePrivateRegistration!();
  const entry = startStep();
  expect(entry.handleOptionSelect(encounter.options[0], 0)).toBe(true);
  await resolveStep();
  if (scenario === "decline") {
    expect(leave).toHaveBeenCalledOnce();
    expect(pushed.mock.calls).toHaveLength(1);
    return;
  }
  picks = [1, 4, 4];
  const category = startStep();
  expect(category.handleOptionSelect(encounter.options[0], 4)).toBe(true);
  await resolveStep();
  expect(encounter.dialogueTokens.contestType).toBe("Beauty");
  picks = ids;
  startStep();
  expect(mode.mock.lastCall?.[0]).toBe(scenario === "no-entrant" ? UiMode.MESSAGE : UiMode.PARTY);
  if (scenario === "switch-mode") {
    const party = scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    party["lastRightPokemonCursor"] = 1;
    party.show(mode.mock.lastCall!.slice(1));
    expect(party["getParty"]()).toBe(scene.getPlayerParty(2));
    expect(scene.inputOwner).toBe("both");
    party.showOptions();
    expect(party["options"]).toEqual([PartyOption.SELECT, PartyOption.SUMMARY, PartyOption.CANCEL]);
    const [, pause] = vi.mocked(scene.uiInputs.beginPrivateDraft).mock.lastCall!;
    await pause(2, 1000);
    expect(party["lastRightPokemonCursor"]).toBe(1);
    expect(party["optionsMode"]).toBe(false);
    const menu = unshifted.mock.lastCall![0] as PrivatePauseMenuPhase;
    current.mockReturnValue(menu);
    menu.start();
    expect(scene.inputOwner).toBe(2);
    scene.privateTurnSelection = false;
    await menu.resume();
    expect(pushed.mock.lastCall![0].phaseName).toBe("MysteryEncounterOptionSelectedPhase");
    expect(encounter.misc.contestTypeVotes).toHaveLength(3);
    expect(encounter.misc.playerContestants).toHaveLength(0);
    return;
  }
  if (scenario !== "no-entrant") mode.mock.lastCall![3](0);
  await resolveStep();
  expect(encounter.misc.playerContestants.map((entry: { pokemon: { id: number } }) => entry.pokemon.id)).toEqual(ids.filter(id => id !== -1));
  expect(pushed.mock.lastCall![0].phaseName).toBe("ContestStartPhase");
});
