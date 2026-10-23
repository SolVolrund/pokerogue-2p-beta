import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { IvScannerModifier } from "#modifiers/modifier";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterUtils from "#mystery-encounters/encounter-phase-utils";
import type { OptionSelectSettings } from "#mystery-encounters/encounter-phase-utils";
import * as PokemonUtils from "#mystery-encounters/encounter-pokemon-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { SafariZoneEncounter } from "#mystery-encounters/safari-zone-encounter";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { ScanIvsPhase } from "#phases/scan-ivs-phase";
import { GameManager } from "#test/framework/game-manager";
import * as PartnerProfiles from "#utils/computer-partner-profile";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Safari Zone multiplayer participation and fixed lanes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let nextMenu: OptionSelectSettings | undefined;
  const fee = 100;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    nextMenu = undefined;
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(EncounterUtils, "transitionMysteryEncounterIntroVisuals").mockResolvedValue(true);
    vi.spyOn(EncounterUtils, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    vi.spyOn(EncounterUtils, "initSubsequentOptionSelect").mockImplementation(settings => { nextMenu = settings; });
    vi.spyOn(game.scene, "getWaveMoneyAmount").mockReturnValue(fee);
    vi.spyOn(game.scene, "setTrainerBackSpritePosition");
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(EncounterUtils, "getRandomEncounterPokemon").mockImplementation(() =>
      game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE),
    );
    vi.spyOn(PokemonUtils, "trainerThrowPokeball").mockResolvedValue(false);
    vi.spyOn(PokemonUtils, "doPlayerFlee").mockResolvedValue();
    vi.spyOn(PokemonUtils, "doPokemonFlee").mockResolvedValue();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function setup(count: 2 | 3 = 3) {
    const scene = game.scene;
    scene.configureTwoPlayerMode(true, 6, false, count);
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 45, battleType: BattleType.MYSTERY_ENCOUNTER, double: false });
    for (const player of scene.getActivePlayerIndexes()) {
      vi.spyOn(scene.getPlayerTrainerBackSprite(player), "setVisible");
      scene.getPlayerParty(player).push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
      scene.setPlayerMoney(1000, player);
    }
    const encounter = new MysteryEncounter(SafariZoneEncounter);
    scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit!();
    nextMenu = { playerIndex: 0, overrideOptions: encounter.options };
    return encounter;
  }

  async function choose(owner: PlayerIndex, option: number) {
    const menu = nextMenu!;
    expect(menu.playerIndex).toBe(owner);
    nextMenu = undefined;
    new MysteryEncounterPhase(menu).start();
    expect(game.scene.inputOwner).toBe(owner);
    expect(game.scene.activePlayerIndex).toBe(owner);
    await menu.overrideOptions![option].onOptionPhase!();
  }

  async function participate(owners: PlayerIndex[], count: 2 | 3 = 3) {
    const encounter = setup(count);
    for (const player of game.scene.getActivePlayerIndexes()) {
      await choose(player, owners.includes(player) ? 0 : 1);
    }
    return encounter;
  }

  const combinations = ([2, 3] as const).flatMap(count =>
    Array.from({ length: (1 << count) - 1 }, (_, index) => ({
      count,
      owners: ([0, 1, 2] as PlayerIndex[]).slice(0, count).filter(player => (index + 1) & (1 << player)),
    })),
  );

  it.each(combinations)("keeps ownership and charges only entrants: $count players, $owners", async ({ count, owners }) => {
    const encounter = await participate(owners, count);
    const scene = game.scene;
    expect(encounter.misc.participatingPlayers).toEqual(owners);
    expect(scene.getPlayerFieldOwners()).toEqual(owners);
    expect(scene.currentBattle.getBattlerCount()).toBe(owners.length);
    expect(scene.getEnemyParty()).toHaveLength(owners.length);
    expect(encounter.misc.safariPokemonRemaining).toBe(2);
    expect(encounter.misc.reservedTargetIds).toBeUndefined();
    expect(nextMenu?.playerIndex).toBe(owners[0]);
    expect(nextMenu?.overrideOptions).toHaveLength(4);
    for (const player of scene.getActivePlayerIndexes()) {
      expect(scene.getPlayerMoney(player)).toBe(owners.includes(player) ? 900 : 1000);
      expect(scene.getPlayerTrainerBackSprite(player).setVisible).toHaveBeenLastCalledWith(owners.includes(player));
    }
    const positions = vi.mocked(scene.setTrainerBackSpritePosition).mock.calls;
    expect(positions.map(call => call[1])).toEqual(owners);
    expect(new Set(positions.map(call => call[2])).size).toBe(owners.length);
    expect(EncounterUtils.leaveEncounterWithoutBattle).not.toHaveBeenCalled();
  });

  it("collects everyone independently and leaves without charging when all sit out", async () => {
    const encounter = setup();
    expect(encounter.options.map(option => option.dialogue?.buttonLabel)).toEqual([
      "mysteryEncounters/safariZone:participation.enter", "mysteryEncounters/safariZone:participation.sitOut",
    ]);
    await choose(0, 1);
    expect(EncounterUtils.leaveEncounterWithoutBattle).not.toHaveBeenCalled();
    await choose(1, 1);
    await choose(2, 1);
    expect(EncounterUtils.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    expect(encounter.continuousEncounter).toBe(false);
    expect(game.scene.getActivePlayerIndexes().map(player => game.scene.getPlayerMoney(player))).toEqual([1000, 1000, 1000]);
    expect(EncounterUtils.getRandomEncounterPokemon).not.toHaveBeenCalled();
  });

  it.each([true, false])("only requests sponsorship for an entrant, accepted: %s", async accepts => {
    const encounter = setup();
    game.scene.setPlayerMoney(0, 1);
    game.scene.setPlayerMoney(0, 2);
    await choose(0, 1);
    await choose(1, 0);
    await choose(2, 1);
    expect(nextMenu?.playerIndex).toBe(0);
    expect(nextMenu?.overrideOptions?.map(option => option.dialogue?.buttonLabel)).toEqual(["menu:yes", "menu:no"]);
    await choose(0, accepts ? 0 : 1);
    expect(game.scene.getPlayerMoney(0)).toBe(accepts ? 900 : 1000);
    expect(encounter.misc.ticketPayments).toEqual(accepts ? [{ playerIndex: 1, payerIndex: 0 }] : []);
    if (accepts) {
      expect(encounter.misc.participatingPlayers).toEqual([1]);
      expect(nextMenu?.playerIndex).toBe(1);
    } else {
      expect(EncounterUtils.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    }
  });

  it("never retargets a finished lane or gives it extra actions", async () => {
    const encounter = await participate([0, 1]);
    const first = encounter.misc.targets[0].pokemon;
    const second = encounter.misc.targets[1].pokemon;
    vi.mocked(PokemonUtils.trainerThrowPokeball).mockImplementation(async pokemon => pokemon === first);
    await choose(0, 0);
    await choose(1, 0);
    expect(encounter.misc.targets[0].active).toBe(false);
    expect(encounter.misc.targets[1].active).toBe(true);
    expect(nextMenu?.playerIndex).toBe(1);
    await choose(1, 0);
    expect(vi.mocked(PokemonUtils.trainerThrowPokeball).mock.calls.map(call => [call[0].id, call[3]])).toEqual([
      [first.id, 0], [second.id, 1], [second.id, 1],
    ]);
    expect(encounter.misc.safariPokemonRemaining).toBe(2);
  });

  it("uses Safari Ball visuals with the unchanged catch probability in solo", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 45, battleType: BattleType.MYSTERY_ENCOUNTER, double: false,
    });
    const encounter = new MysteryEncounter(SafariZoneEncounter);
    game.scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit!();
    await encounter.options[0].onOptionPhase!();
    await nextMenu!.overrideOptions![0].onOptionPhase!();
    const expectedRate = Math.round(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.round(255 * 1.5))));
    expect(PokemonUtils.trainerThrowPokeball).toHaveBeenCalledWith(
      encounter.misc.pokemon, PokeballType.SAFARI_BALL, expectedRate, 0,
    );
  });

  it("uses the same Safari Ball appearance and catch probability for multiplayer lanes", async () => {
    const encounter = await participate([1, 2]);
    await choose(1, 0);
    await choose(2, 0);
    const expectedRate = Math.round(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.round(255 * 1.5))));
    for (const player of [1, 2]) {
      expect(PokemonUtils.trainerThrowPokeball).toHaveBeenCalledWith(
        encounter.misc.targets[player].pokemon, PokeballType.SAFARI_BALL, expectedRate, player,
      );
    }
  });

  it("reserves the payer's own fee and never sponsors more tickets than they can afford", async () => {
    const encounter = setup();
    game.scene.setPlayerMoney(fee * 2, 0);
    game.scene.setPlayerMoney(0, 1);
    game.scene.setPlayerMoney(0, 2);
    await choose(0, 0);
    await choose(1, 0);
    await choose(2, 0);
    await choose(0, 0);
    expect(encounter.misc.participatingPlayers).toEqual([0, 1]);
    expect(game.scene.getPlayerMoney(0)).toBe(0);
    expect(encounter.misc.ticketPayments).toHaveLength(2);
    expect(nextMenu?.playerIndex).toBe(0);
    expect(nextMenu?.overrideOptions).toHaveLength(4);
  });

  it("advances together after fleeing and ends after exactly three groups", async () => {
    const encounter = await participate([1, 2]);
    for (let group = 0; group < 3; group++) {
      const first = encounter.misc.targets[1].pokemon;
      const second = encounter.misc.targets[2].pokemon;
      await choose(1, 3);
      await choose(2, 3);
      expect(PokemonUtils.doPlayerFlee).toHaveBeenCalledWith(first);
      expect(PokemonUtils.doPlayerFlee).toHaveBeenCalledWith(second);
      if (group < 2) {
        expect(nextMenu?.playerIndex).toBe(1);
      }
    }
    expect(EncounterUtils.getRandomEncounterPokemon).toHaveBeenCalledTimes(6);
    expect(encounter.continuousEncounter).toBe(false);
    expect(EncounterUtils.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    expect(game.scene.currentBattle.playerFieldOwners).toBeUndefined();
  });

  it("routes an IV scan to its owner and restores the next menu owner afterward", async () => {
    setup();
    game.scene.getPlayerModifiers(2).push(new IvScannerModifier(getModifierType(modifierTypes.IV_SCANNER)));
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    await choose(0, 1);
    await choose(1, 0);
    await choose(2, 0);
    const enemySlot = game.scene.getEnemyBattlerIndex(1);
    expect(push).toHaveBeenCalledWith("ScanIvsPhase", enemySlot, 2);
    const scan = new ScanIvsPhase(enemySlot, 2);
    for (const enemy of game.scene.getEnemyField()) {
      enemy.getBattleInfo().getStatsValueContainer().list = [];
    }
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    scan.start();
    expect(game.scene.inputOwner).toBe(2);
    new MysteryEncounterPhase(nextMenu).start();
    expect(game.scene.inputOwner).toBe(1);
    const phase = new MysteryEncounterPhase(nextMenu);
    vi.spyOn(phase, "continueEncounter").mockImplementation(() => {});
    phase.handleOptionSelect(nextMenu!.overrideOptions![0], 0);
    expect(game.scene.inputOwner).toBe(1);
  });

  it("lets CPU-only remaining participants finish without requesting a CPU's input", async () => {
    const encounter = setup(2);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(player => player === 1);
    vi.spyOn(PartnerProfiles, "getBestComputerPartnerReplacementSlot").mockReturnValue(undefined);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await choose(0, 1);
    expect(encounter.misc.participatingPlayers).toEqual([1]);
    expect(PokemonUtils.doPlayerFlee).not.toHaveBeenCalled();
    for (let group = 0; group < 3; group++) {
      const action = push.mock.calls.find(call => call[0] === "MysteryEncounterOptionSelectedPhase")!;
      expect(action).toBeDefined();
      const summonIndex = unshift.mock.calls.findIndex(call => call[0] === "PostSummonPhase");
      expect(summonIndex).toBeGreaterThanOrEqual(0);
      expect(unshift.mock.invocationCallOrder[summonIndex]).toBeLessThan(push.mock.invocationCallOrder[push.mock.calls.indexOf(action)]);
      push.mockClear();
      unshift.mockClear();
      await (action[1] as () => Promise<boolean>)();
    }
    expect(PokemonUtils.doPlayerFlee).toHaveBeenCalledTimes(3);
    expect(EncounterUtils.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    expect(game.scene.inputOwner).toBe(0);
    expect(nextMenu).toBeUndefined();
  });

  it("lets a CPU catch only its own target and returns the remaining lane to the human", async () => {
    const encounter = setup(2);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(player => player === 1);
    vi.spyOn(PartnerProfiles, "getBestComputerPartnerReplacementSlot").mockReturnValue({
      slotIndex: 1,
      role: "balanced",
      currentScore: undefined,
      candidateScore: 100,
      improvementRatio: 2,
      canReplace: true,
      replacedPokemon: undefined,
      replacedPokemonIndex: undefined,
      currentTeamScore: 100,
      candidateTeamScore: 200,
    });
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    await choose(0, 0);
    const humanTarget = encounter.misc.targets[0].pokemon;
    const cpuTarget = encounter.misc.targets[1].pokemon;
    vi.mocked(PokemonUtils.trainerThrowPokeball).mockImplementation(async pokemon => {
      expect(game.scene.inputOwner).toBe(0);
      return pokemon === cpuTarget;
    });
    await choose(0, 0);
    const action = push.mock.calls.find(call => call[0] === "MysteryEncounterOptionSelectedPhase")!;
    await (action[1] as () => Promise<boolean>)();
    expect(vi.mocked(PokemonUtils.trainerThrowPokeball).mock.calls.map(call => [call[0].id, call[3]])).toEqual([
      [humanTarget.id, 0], [cpuTarget.id, 1],
    ]);
    expect(encounter.misc.targets[1].active).toBe(false);
    expect(nextMenu?.playerIndex).toBe(0);
  });

  it("does not mutate the solo menu or its entry price", () => {
    setup();
    game.scene.configureTwoPlayerMode(false);
    const solo = new MysteryEncounter(SafariZoneEncounter);
    game.scene.currentBattle.mysteryEncounter = solo;
    solo.onInit!();
    expect(solo.dialogue.encounterOptionsDialogue?.query).toBe("mysteryEncounters/safariZone:query");
    expect(solo.options[0].dialogue?.buttonLabel).toBe("mysteryEncounters/safariZone:option.1.label");
    game.scene.money = 0;
    expect(solo.options[0].meetsRequirements()).toBe(false);
  });

  it("keeps CPU-versus-EP progression prompts under EP control", async () => {
    const encounter = setup(2);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockReturnValue(true);
    vi.spyOn(game.scene, "isCpuPlayersVsEnemyPlayerMode").mockReturnValue(true);
    vi.spyOn(PartnerProfiles, "getBestComputerPartnerReplacementSlot").mockReturnValue(undefined);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    vi.mocked(PokemonUtils.doPlayerFlee).mockImplementation(async () => {
      expect(game.scene.inputOwner).toBe("ep");
    });
    await encounter.options[0].onOptionPhase!();
    for (let player = 0; player < 2; player++) {
      const action = push.mock.calls.findLast(call => call[0] === "MysteryEncounterOptionSelectedPhase")!;
      await (action[1] as () => Promise<boolean>)();
    }
    expect(PokemonUtils.doPlayerFlee).toHaveBeenCalledTimes(2);
    expect(game.scene.inputOwner).toBe("ep");
  });
});
