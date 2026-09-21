import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import { SingleTypeChallenge } from "#data/challenge";
import { Challenges, isSingleTypeChallenge } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { TitlePhase } from "#phases/title-phase";
import { ChallengeData } from "#system/challenge-data";
import { GameManager } from "#test/framework/game-manager";
import type { GameChallengesUiHandler } from "#ui/challenges-select-ui-handler";
import { checkStarterValidForChallenge, getChallengesForPlayer } from "#utils/challenge-utils";
import { getComputerPartnerCaptureInterests } from "#utils/computer-partner-capture-ai";
import {
  createComputerPartnerStarter,
  getComputerPartnerChallengeProfile,
  getComputerPartnerProfile,
  getComputerPartnerReplacementScores,
  isComputerPartnerCandidateAllowed,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Player-specific Mono Type", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const ids = [Challenges.SINGLE_TYPE_P1, Challenges.SINGLE_TYPE_P2, Challenges.SINGLE_TYPE_P3];
  const props = { shiny: false, female: false, variant: 0 as const, formIndex: 0 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(ids[0], PokemonType.FIRE + 1);
    game.scene.gameMode.setChallengeValue(ids[1], PokemonType.WATER + 1);
    game.scene.gameMode.setChallengeValue(ids[2], PokemonType.GRASS + 1);
  });

  function valid(speciesId: SpeciesId, playerIndex: PlayerIndex, soft = false): boolean {
    return checkStarterValidForChallenge(getPokemonSpecies(speciesId), props, soft, playerIndex);
  }

  function addPokemon(speciesId: SpeciesId, playerIndex: PlayerIndex) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 20);
    game.scene.getPlayerParty(playerIndex).push(pokemon);
    return pokemon;
  }

  it("offers independent P1, P2 and P3 rows and uses the active selector by default", () => {
    const rules = game.scene.gameMode.challenges.filter(c => isSingleTypeChallenge(c.id));
    expect(rules.map(c => c.id)).toEqual(ids);
    expect(rules.map(c => c.getName())).toEqual(["Mono Type P1", "Mono Type P2", "Mono Type P3"]);
    expect(valid(SpeciesId.CHARMANDER, 0)).toBe(true);
    expect(valid(SpeciesId.CHARMANDER, 1)).toBe(false);
    expect(valid(SpeciesId.SQUIRTLE, 1)).toBe(true);
    expect(valid(SpeciesId.BULBASAUR, 2)).toBe(true);
    game.scene.setActivePlayerIndex(1);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.SQUIRTLE), props, false)).toBe(true);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.CHARMANDER), props, false)).toBe(false);
  });

  it("supports matching types, Off, and owner-specific evolution eligibility", () => {
    game.scene.gameMode.setChallengeValue(ids[1], PokemonType.FIRE + 1);
    game.scene.gameMode.setChallengeValue(ids[2], 0);
    expect(valid(SpeciesId.CHARMANDER, 1)).toBe(true);
    expect(valid(SpeciesId.SQUIRTLE, 2)).toBe(true);
    game.scene.gameMode.setChallengeValue(ids[1], PokemonType.FLYING + 1);
    expect(valid(SpeciesId.CHARMANDER, 1, true)).toBe(true);
    expect(valid(SpeciesId.CHARMANDER, 1)).toBe(false);
    expect(valid(SpeciesId.SQUIRTLE, 1, true)).toBe(false);
  });

  it("uses the Pokemon's owner, not the player currently controlling the UI, in battle", () => {
    const fire = addPokemon(SpeciesId.CHARMANDER, 0);
    const water = addPokemon(SpeciesId.SQUIRTLE, 1);
    const wrongType = addPokemon(SpeciesId.CHARMANDER, 1);
    const grass = addPokemon(SpeciesId.BULBASAUR, 2);
    game.scene.setActivePlayerIndex(2);
    expect([fire, water, wrongType, grass].map(p => p.isAllowedInBattle())).toEqual([true, true, false, true]);
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([water]);
  });

  it("round-trips scoped rules and retains shared semantics for old saves", () => {
    const saved = JSON.parse(JSON.stringify(game.scene.gameMode.challenges.map(c => new ChallengeData(c))));
    game.scene.gameMode.challenges = saved.map(c => new ChallengeData(c).toChallenge());
    expect(valid(SpeciesId.SQUIRTLE, 1)).toBe(true);
    expect(valid(SpeciesId.SQUIRTLE, 0)).toBe(false);
    game.scene.gameMode.challenges = [
      new ChallengeData({
        id: Challenges.SINGLE_TYPE,
        value: PokemonType.WATER + 1,
        severity: 0,
      }).toChallenge(),
    ];
    for (const player of [0, 1, 2] as const) {
      expect(valid(SpeciesId.SQUIRTLE, player)).toBe(true);
      expect(valid(SpeciesId.CHARMANDER, player)).toBe(false);
    }
  });

  it("limits ribbon and achievement rules to their owner and preserves the legacy setter", () => {
    for (const player of [0, 1, 2] as const) {
      const rules = getChallengesForPlayer(player).filter(c => c instanceof SingleTypeChallenge);
      expect(rules.map(c => c.id)).toEqual([ids[player]]);
      expect(rules[0].ribbonAwarded).not.toBe(0n);
    }
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE, PokemonType.ICE + 1);
    expect(game.scene.gameMode.challenges.filter(c => isSingleTypeChallenge(c.id)).map(c => c.value)).toEqual([
      PokemonType.ICE + 1,
      PokemonType.ICE + 1,
      PokemonType.ICE + 1,
    ]);
  });

  it("draws separate icons for all three rows and clears stale icons on scroll", () => {
    const handler = game.scene.ui.handlers[UiMode.CHALLENGE_SELECT] as GameChallengesUiHandler;
    handler["challengesContainer"].update = () => {};
    const labels = handler["challengeLabels"];
    const visibility = labels.map(label => vi.spyOn(label.typeIcon, "setVisible"));
    const frames = labels.map(label => vi.spyOn(label.typeIcon, "setFrame"));
    handler.show([]);
    const rules = game.scene.gameMode.challenges;
    for (const id of ids) {
      const row = rules.findIndex(c => c.id === id);
      expect(visibility[row]).toHaveBeenLastCalledWith(true);
      expect(frames[row]).toHaveBeenLastCalledWith(rules[row].getValue());
    }
    handler["scrollCursor"] = rules.length - labels.length;
    handler["updateText"]();
    for (const [row, label] of labels.entries()) {
      expect(visibility[row]).toHaveBeenLastCalledWith(isSingleTypeChallenge(rules[handler["scrollCursor"] + row].id));
      expect(label.typeIcon).not.toBe(labels[(row + 1) % labels.length].typeIcon);
    }
  });

  it("does not start or broadcast when only an unused seat has a challenge", () => {
    game.scene.gameMode.setChallengeValue(ids[0], 0);
    game.scene.gameMode.setChallengeValue(ids[1], 0);
    const title = new TitlePhase();
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart");
    const end = vi.spyOn(title, "end").mockImplementation(() => {});
    title["startMultiplayerRun"](GameModes.CHALLENGE, 2, 6);
    expect(broadcast).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
  });

  it("clears unused seats in a new solo run without losing the settings snapshot", () => {
    const title = new TitlePhase();
    title.gameMode = GameModes.CHALLENGE;
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    game.scene.configureTwoPlayerMode(false);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    title.end();
    expect(game.scene.gameMode.challenges.filter(c => isSingleTypeChallenge(c.id)).map(c => c.value)).toEqual([
      PokemonType.FIRE + 1,
      0,
      0,
    ]);
    expect(title["selectedChallenges"].find(c => c.id === ids[1])?.value).toBe(PokemonType.WATER + 1);
  });

  it("filters CPU starter pools by their own seat, promoting an eligible ace", () => {
    const profile = {
      ...getComputerPartnerProfile("riley"),
      startingStarters: [
        { speciesId: SpeciesId.CHARMANDER, points: 1 },
        { speciesId: SpeciesId.SQUIRTLE, points: 1 },
        { speciesId: SpeciesId.TOTODILE, points: 1 },
      ],
    };
    const filtered = getComputerPartnerChallengeProfile(profile, 1);
    expect(filtered.startingStarters?.map(s => s.speciesId)).toEqual([SpeciesId.SQUIRTLE, SpeciesId.TOTODILE]);
    const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
    expect(starters[0].speciesId).toBe(SpeciesId.SQUIRTLE);
    expect(starters.every(s => valid(s.speciesId, 1))).toBe(true);
    expect(createComputerPartnerStarter(profile, undefined, 6, 2)).toEqual([]);
    expect(profile.startingStarters).toHaveLength(3);
  });

  it("blocks incompatible CPU selections before broadcasting but permits player-selected CPU teams", async () => {
    const title = new TitlePhase();
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    game.scene.setComputerPartnerKey(1, "riley");
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const text = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart");
    const end = vi.spyOn(title, "end").mockImplementation(() => {});
    title["startMultiplayerRun"](GameModes.CHALLENGE, 2, 6, [1]);
    await Promise.resolve();
    expect(text.mock.calls.at(-1)?.[0]).toContain("Riley has no eligible starters for P2's Mono Type");
    expect(broadcast).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    game.scene.setComputerPartnerKey(1, "alex");
    expect(title["validateChallengePlayers"](GameModes.CHALLENGE)).toBe(true);
  });

  it("rejects CPU reward and capture candidates of another player's type, even forced throws", () => {
    const party = [addPokemon(SpeciesId.SQUIRTLE, 1)];
    const profile = getComputerPartnerProfile("alex");
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CHARMANDER), 1)).toBe(false);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.TOTODILE), 1)).toBe(true);
    expect(getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.CHARMANDER))).toEqual([]);
    game.scene.newBattle();
    const target = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 20, TrainerSlot.NONE);
    vi.spyOn(target, "isActive").mockReturnValue(true);
    vi.spyOn(target, "isBoss").mockReturnValue(false);
    expect(
      getComputerPartnerCaptureInterests("alex", party, [target], undefined, undefined, {
        playerIndex: 1,
        forceThrowTargetIds: [target.id],
      }),
    ).toEqual([]);
  });
});
