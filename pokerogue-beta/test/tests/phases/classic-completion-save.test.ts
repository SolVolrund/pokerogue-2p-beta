import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { Unlockables } from "#enums/unlockables";
import { Pokemon } from "#field/pokemon";
import { GameOverPhase } from "#phases/game-over-phase";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import { decrypt } from "#utils/data";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Classic completion persistence", () => {
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
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 200;
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
  });

  async function completeBeforeEnding(phase: GameOverPhase): Promise<() => void> {
    vi.spyOn(pokerogueApi.savedata.session, "newclear").mockResolvedValue(true);
    vi.spyOn(game.scene.gameData, "offlineNewClear").mockResolvedValue(true);
    const delayed = vi.spyOn(game.scene.time, "delayedCall").mockReturnValue({} as Phaser.Time.TimerEvent);
    let finishFade!: () => void;
    vi.spyOn(game.scene.ui, "fadeOut").mockReturnValue(
      new Promise(resolve => {
        finishFade = resolve;
      }),
    );
    phase.handleGameOver();
    await vi.waitFor(() => expect(delayed.mock.calls.some(call => call[0] === 1000)).toBe(true));
    const callback = delayed.mock.calls.find(call => call[0] === 1000)![1];
    callback();
    return finishFade;
  }

  it.each([1, 2, 3] as const)("saves %i human profiles before any ending dialogue or unlock prompt", async count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    game.scene.currentBattle.classicFinalBossSpeciesId = SpeciesId.ETERNATUS;
    const snapshots = new Map<number, ReturnType<GameData["getSystemSaveData"]>>();
    for (const owner of game.scene.getActivePlayerIndexes()) {
      const data = game.scene.getPlayerGameData(owner);
      data.gameStats.sessionsWon = 0;
      data.gameStats.ribbonsOwned = 0;
      data.unlocks[Unlockables.ENDLESS_MODE] = false;
      data.unlocks[Unlockables.MINI_BLACK_HOLE] = false;
      const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.BULBASAUR), 50);
      game.scene.getPlayerParty(owner).push(pokemon);
    }
    const snapshot = (owner: 0 | 1 | 2 = game.scene.activePlayerIndex) => {
      snapshots.set(owner, JSON.parse(game.scene.getPlayerGameData(owner).getSystemSaveDataString()));
    };
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(snapshot);
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => snapshot(0));
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await completeBeforeEnding(new GameOverPhase(true));
    expect(snapshots.size).toBe(count);
    for (const saved of snapshots.values()) {
      expect(saved.gameStats.sessionsWon).toBe(1);
      expect(saved.gameStats.ribbonsOwned).toBeGreaterThan(0);
      expect(saved.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
      expect(saved.unlocks[Unlockables.MINI_BLACK_HOLE]).toBe(true);
      expect(saved.achvUnlocks.CLASSIC_VICTORY).toBeDefined();
    }
    expect(queue.mock.calls.some(call => call[0] === "UnlockPhase")).toBe(false);
  });

  it.each([
    [SpeciesId.ETERNATUS, Unlockables.MINI_BLACK_HOLE],
    [SpeciesId.NECROZMA, Unlockables.GAMMA_RAY_BURST],
    [SpeciesId.MEW, Unlockables.OLD_SEA_MAP],
    [SpeciesId.UNOWN, Unlockables.UNOWN_BOX],
    [SpeciesId.MEWTWO, undefined],
  ] as const)("records completion for boss %i without waiting for its ending", async (boss, reward) => {
    game.scene.currentBattle.classicFinalBossSpeciesId = boss;
    const saved = vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await completeBeforeEnding(new GameOverPhase(true));
    expect(saved).toHaveBeenCalled();
    expect(game.scene.gameData.gameStats.sessionsWon).toBe(1);
    expect(game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
    if (reward !== undefined) {
      expect(game.scene.gameData.unlocks[reward]).toBe(true);
    }
  });

  it("keeps Spliced locked unless the winning party contains a fusion", async () => {
    await completeBeforeEnding(new GameOverPhase(true));
    expect(game.scene.gameData.unlocks[Unlockables.SPLICED_ENDLESS_MODE]).toBe(false);
  });

  it("saves Spliced eligibility before ending screens", async () => {
    const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.BULBASAUR), 50);
    pokemon.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.CHARMANDER);
    game.scene.getPlayerParty().push(pokemon);
    await completeBeforeEnding(new GameOverPhase(true));
    expect(game.scene.gameData.unlocks[Unlockables.SPLICED_ENDLESS_MODE]).toBe(true);
  });

  it("does not credit a loss", async () => {
    const phase = new GameOverPhase(false);
    phase["saveDejaVuGhosts"] = () => {};
    const save = vi.spyOn(game.scene.gameData, "saveSystemLocal");
    await completeBeforeEnding(phase);
    expect(game.scene.gameData.gameStats.sessionsWon).toBe(0);
    expect(game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE]).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("can reload the completed profile from local storage while the ending is still paused", async () => {
    await completeBeforeEnding(new GameOverPhase(true));
    const stored = localStorage.getItem(`data_${loggedInUser?.username}`);
    expect(stored).not.toBeNull();
    const reloaded = GameData.fromRawSystem(decrypt(stored!, true), false);
    expect(reloaded.gameStats.sessionsWon).toBe(1);
    expect(reloaded.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
  });

  it("still announces newly earned unlocks after they have been saved", async () => {
    const phase = new GameOverPhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase["getRunHistoryEntry"] = async () => game.scene.gameData.getSessionSaveData();
    vi.spyOn(game.scene.gameData, "saveRunHistory").mockResolvedValue(true);
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const finishFade = await completeBeforeEnding(phase);
    expect(game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
    finishFade();
    await Promise.resolve();
    expect(queue).toHaveBeenCalledWith("UnlockPhase", Unlockables.ENDLESS_MODE, [0]);
  });

  it.each([
    [true, 0, true, 1],
    [true, 4, true, 4],
    [false, 2, true, 2],
    [false, 0, false, 0],
  ] as const)("recovers only evidenced clears (achievement %s, wins %i)", (achievement, wins, unlocked, expectedWins) => {
    const raw = JSON.parse(game.scene.gameData.getSystemSaveDataString());
    raw.achvUnlocks = achievement ? { CLASSIC_VICTORY: 1786133471543 } : {};
    raw.gameStats.sessionsWon = wins;
    raw.gameStats.pokemonFused = 10;
    raw.unlocks[Unlockables.ENDLESS_MODE] = false;
    raw.unlocks[Unlockables.SPLICED_ENDLESS_MODE] = false;
    const recovered = GameData.fromRawSystem(JSON.stringify(raw), false);
    expect(recovered.unlocks[Unlockables.ENDLESS_MODE]).toBe(unlocked);
    expect(recovered.gameStats.sessionsWon).toBe(expectedWins);
    expect(recovered.unlocks[Unlockables.SPLICED_ENDLESS_MODE]).toBe(false);
    expect(recovered.gameStats.ribbonsOwned).toBe(0);
    expect(recovered.unlocks[Unlockables.MINI_BLACK_HOLE]).toBe(false);
    const reloaded = GameData.fromRawSystem(recovered.getSystemSaveDataString(), false);
    expect(reloaded.gameStats.sessionsWon).toBe(expectedWins);
  });

  it("persists recovery when loading the local profile", async () => {
    const raw = JSON.parse(game.scene.gameData.getSystemSaveDataString());
    raw.achvUnlocks = { CLASSIC_VICTORY: 1786133471543 };
    raw.gameStats.sessionsWon = 0;
    raw.unlocks[Unlockables.ENDLESS_MODE] = false;
    const save = vi.spyOn(game.scene.gameData, "saveSystemLocal");
    expect(await game.scene.gameData.initSystem(JSON.stringify(raw))).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
    expect(game.scene.gameData.gameStats.sessionsWon).toBe(1);
  });
});
